import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { Edit, SgNode, SgRoot } from "@codemod.com/jssg-types/main";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);

interface Range {
  start: number;
  end: number;
}

function rangeOf(node: SgNode<Js>): Range {
  const range = node.range();
  return { start: range.start.index, end: range.end.index };
}

function unquote(text: string): string {
  return text.replace(/^["'`]/, "").replace(/["'`]$/, "");
}

function namedChildren(node: SgNode<Js>): SgNode<Js>[] {
  return node.children().filter((child) => child.isNamed());
}

function keyName(pair: SgNode<Js>): string | null {
  const key = pair.field("key");
  return key ? unquote(key.text()) : null;
}

function pairsOf(objectNode: SgNode<Js>): SgNode<Js>[] {
  return namedChildren(objectNode).filter((child) => child.kind() === "pair");
}

function findPair(objectNode: SgNode<Js>, name: string): SgNode<Js> | undefined {
  return pairsOf(objectNode).find((pair) => keyName(pair) === name);
}

// Whitespace at the start of the line containing `index`.
function lineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : "";
}

function isInsideAny(range: Range, ranges: Range[]): boolean {
  return ranges.some((outer) => range.start >= outer.start && range.end <= outer.end);
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  const rootNode = root.root();
  const source = rootNode.text();

  // Bindings introduced by `require`/`import` of mini-css-extract-plugin.
  const pluginBindings: { name: string; statement: SgNode<Js> }[] = [];
  const importPatterns = [
    "const $NAME = require($SOURCE)",
    "let $NAME = require($SOURCE)",
    "var $NAME = require($SOURCE)",
    "import $NAME from $SOURCE",
  ];
  for (const pattern of importPatterns) {
    for (const statement of rootNode.findAll({ rule: { pattern } })) {
      const name = statement.getMatch("NAME");
      const moduleSource = statement.getMatch("SOURCE");
      if (!name || !moduleSource) continue;
      if (unquote(moduleSource.text()) !== PLUGIN_MODULE) continue;
      pluginBindings.push({ name: name.text(), statement });
    }
  }
  const pluginNames = new Set(pluginBindings.map((binding) => binding.name));

  // `MiniCssExtractPlugin.loader` or `require("mini-css-extract-plugin").loader`.
  const isPluginLoaderExpression = (node: SgNode<Js>): boolean => {
    if (node.kind() !== "member_expression") return false;
    const objectPart = node.field("object");
    const propertyPart = node.field("property");
    if (!objectPart || !propertyPart || propertyPart.text() !== "loader") return false;
    if (objectPart.kind() === "identifier") return pluginNames.has(objectPart.text());
    return (
      objectPart.kind() === "call_expression" &&
      /^require\(\s*["'`]mini-css-extract-plugin["'`]\s*\)$/.test(objectPart.text())
    );
  };

  // Loader name behind a `use` entry: a plain string or `{ loader: "..." }`.
  const loaderNameOf = (node: SgNode<Js>): string | null => {
    if (node.kind() === "string") return unquote(node.text());
    if (node.kind() !== "object") return null;
    const loaderValue = findPair(node, "loader")?.field("value");
    return loaderValue && loaderValue.kind() === "string" ? unquote(loaderValue.text()) : null;
  };

  // A `use` entry replaceable by native CSS: a known loader string, the
  // plugin's `.loader`, or `{ loader: <one of those>, ... }`.
  const isRemovableUseElement = (node: SgNode<Js>): boolean => {
    if (isPluginLoaderExpression(node)) return true;
    if (node.kind() === "object") {
      const loaderValue = findPair(node, "loader")?.field("value");
      if (loaderValue && isPluginLoaderExpression(loaderValue)) return true;
    }
    const name = loaderNameOf(node);
    return name !== null && REMOVABLE_LOADERS.has(name);
  };

  // Whether the rule still claims plain `.css` resources after the transform —
  // if so it disables the `experiments.css: "auto"` default, which then needs
  // an explicit `true`. Unreadable conditions count as matching, to be safe.
  const ruleMatchesCssFiles = (ruleObject: SgNode<Js>): boolean => {
    const testValue = findPair(ruleObject, "test")?.field("value");
    if (!testValue) return true;
    if (testValue.kind() !== "regex") return true;
    const literal = /^\/(.*)\/([a-z]*)$/s.exec(testValue.text());
    if (!literal) return true;
    try {
      const regex = new RegExp(literal[1], literal[2]);
      return regex.test("/file.css") || regex.test("/file.module.css");
    } catch {
      return true;
    }
  };

  const edits: Edit[] = [];
  const editedRanges: Range[] = [];
  const configObjects: SgNode<Js>[] = [];

  const removeText = (range: Range): void => {
    edits.push({ startPos: range.start, endPos: range.end, insertedText: "" });
    editedRanges.push(range);
  };

  // Removals of comma-separated list items are grouped per parent container so
  // sibling removals in the same object/array never produce overlapping ranges.
  const pendingRemovals = new Map<number, { parent: SgNode<Js>; removed: Set<number> }>();

  const markForRemoval = (node: SgNode<Js>): void => {
    const parent = node.parent();
    if (!parent) return;
    const key = parent.range().start.index;
    let group = pendingRemovals.get(key);
    if (!group) {
      group = { parent, removed: new Set() };
      pendingRemovals.set(key, group);
    }
    group.removed.add(node.range().start.index);
  };

  const finalizeRemovals = (): void => {
    for (const { parent, removed } of pendingRemovals.values()) {
      const children = namedChildren(parent);
      if (children.every((child) => removed.has(child.range().start.index))) {
        edits.push(parent.replace(parent.kind() === "array" ? "[]" : "{}"));
        editedRanges.push(rangeOf(parent));
        continue;
      }
      // Delete each contiguous run of removed children up to the next kept
      // sibling, or back to the previous kept one for a trailing run.
      let index = 0;
      while (index < children.length) {
        if (!removed.has(children[index].range().start.index)) {
          index += 1;
          continue;
        }
        let runEnd = index;
        while (
          runEnd + 1 < children.length &&
          removed.has(children[runEnd + 1].range().start.index)
        ) {
          runEnd += 1;
        }
        const next = children[runEnd + 1];
        if (next) {
          removeText({
            start: children[index].range().start.index,
            end: next.range().start.index,
          });
        } else {
          removeText({
            start: children[index - 1].range().end.index,
            end: children[runEnd].range().end.index,
          });
        }
        index = runEnd + 1;
      }
    }
  };

  // The enclosing webpack config object: nearest ancestor holding a `module` pair.
  const findConfigForRule = (node: SgNode<Js>): SgNode<Js> | null => {
    let current = node.parent();
    while (current) {
      if (current.kind() === "pair" && keyName(current) === "module") {
        const parent = current.parent();
        if (parent && parent.kind() === "object") return parent;
      }
      current = current.parent();
    }
    return null;
  };

  // Rules holding only `test` + `use` can be dropped outright: with no user rule
  // matching `.css`, `experiments.css: "auto"` enables native CSS by itself.
  // Rules with extra conditions must stay, which disables the "auto" default —
  // only those configs need an explicit `experiments.css: true`.
  interface UseSwap {
    pair: SgNode<Js>;
    ruleObject: SgNode<Js>;
    keptLoaders: SgNode<Js>[];
  }
  interface RulesArrayWork {
    arrayNode: SgNode<Js>;
    removedElements: SgNode<Js>[];
    swaps: UseSwap[];
  }
  const rulesWork = new Map<number, RulesArrayWork>();

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "use") continue;
    const value = pair.field("value");
    if (!value) continue;
    const elements = value.kind() === "array" ? namedChildren(value) : [value];
    if (!elements.length) continue;
    const removable = elements.filter(isRemovableUseElement);
    // Any other loader (preprocessors, custom ones) stays in front of native CSS.
    const kept = elements.filter((element) => !isRemovableUseElement(element));
    if (!removable.length) continue;
    const ruleObject = pair.parent();
    if (!ruleObject || ruleObject.kind() !== "object") continue;
    const arrayNode = ruleObject.parent();
    const key = arrayNode ? arrayNode.range().start.index : rangeOf(pair).start;
    let work = rulesWork.get(key);
    if (!work && arrayNode) {
      work = { arrayNode, removedElements: [], swaps: [] };
      rulesWork.set(key, work);
    }
    if (!work) continue;
    const trivialRule = pairsOf(ruleObject).every((rulePair) => {
      const name = keyName(rulePair);
      return name === "test" || name === "use";
    });
    if (trivialRule && !kept.length && arrayNode && arrayNode.kind() === "array") {
      work.removedElements.push(ruleObject);
    } else {
      work.swaps.push({ pair, ruleObject, keptLoaders: kept });
    }
  }

  for (const work of rulesWork.values()) {
    const allElements = namedChildren(work.arrayNode);
    if (work.removedElements.length === allElements.length && !work.swaps.length) {
      // The whole rules array goes away — cascade to `rules`/`module` when empty.
      let removalTarget: SgNode<Js> = work.arrayNode;
      const rulesPair = work.arrayNode.parent();
      if (rulesPair && rulesPair.kind() === "pair") {
        removalTarget = rulesPair;
        const moduleObject = rulesPair.parent();
        const modulePair = moduleObject ? moduleObject.parent() : null;
        if (
          moduleObject &&
          moduleObject.kind() === "object" &&
          pairsOf(moduleObject).length === 1 &&
          modulePair &&
          modulePair.kind() === "pair" &&
          keyName(modulePair) === "module"
        ) {
          removalTarget = modulePair;
        }
      }
      markForRemoval(removalTarget);
      continue;
    }
    for (const element of work.removedElements) {
      markForRemoval(element);
    }
    for (const swap of work.swaps) {
      if (swap.keptLoaders.length) {
        // Preprocessor loaders stay in `use`; native CSS parses their output.
        const keptTexts = swap.keptLoaders.map((loader) => loader.text());
        const indent = lineIndent(source, swap.pair.range().start.index);
        const separator = swap.ruleObject.text().includes("\n") ? `,\n${indent}` : ", ";
        edits.push(
          swap.pair.replace(`use: [${keptTexts.join(", ")}]${separator}type: "css/auto"`),
        );
      } else {
        edits.push(swap.pair.replace('type: "css/auto"'));
      }
      editedRanges.push(rangeOf(swap.pair));
      // A surviving rule that matches `.css` turns the "auto" default off.
      if (!ruleMatchesCssFiles(swap.ruleObject)) continue;
      const config = findConfigForRule(swap.pair);
      if (config) configObjects.push(config);
    }
  }

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "plugins") continue;
    const value = pair.field("value");
    if (!value || value.kind() !== "array") continue;
    const elements = namedChildren(value);
    const removed = elements.filter((element) => {
      if (element.kind() !== "new_expression") return false;
      const constructorNode = element.field("constructor");
      return constructorNode !== null && pluginNames.has(constructorNode.text());
    });
    if (!removed.length) continue;
    if (removed.length === elements.length) {
      markForRemoval(pair);
    } else {
      for (const element of removed) markForRemoval(element);
    }
  }

  finalizeRemovals();

  if (!edits.length) return null;

  // Drop the plugin import once no reference survives outside the edited ranges.
  for (const binding of pluginBindings) {
    const statementRange = rangeOf(binding.statement);
    const survivingReference = rootNode
      .findAll({ rule: { kind: "identifier" } })
      .some((identifier) => {
        if (identifier.text() !== binding.name) return false;
        const range = rangeOf(identifier);
        if (range.start >= statementRange.start && range.end <= statementRange.end) return false;
        return !isInsideAny(range, editedRanges);
      });
    if (survivingReference) continue;
    let end = statementRange.end;
    if (source[end] === "\r") end += 1;
    if (source[end] === "\n") end += 1;
    // At the top of the file also swallow the blank line that separated it.
    while (statementRange.start === 0 && (source[end] === "\n" || source[end] === "\r")) {
      end += 1;
    }
    edits.push({ startPos: statementRange.start, endPos: end, insertedText: "" });
  }

  // Insert a property right after an object's opening brace, matching its layout.
  const insertIntoObject = (
    objectNode: SgNode<Js>,
    buildProperty: (indent: string, indentUnit: string) => string,
  ): void => {
    const range = rangeOf(objectNode);
    const insertAt = range.start + 1;
    const properties = namedChildren(objectNode);
    const multiline = objectNode.text().includes("\n") && properties.length > 0;
    let insertedText: string;
    if (multiline) {
      const indent = lineIndent(source, properties[0].range().start.index);
      const indentUnit = indent.includes("\t") ? "\t" : indent || "  ";
      insertedText = `\n${indent}${buildProperty(indent, indentUnit)},`;
    } else if (properties.length) {
      insertedText = ` ${buildProperty("", "")},`;
    } else {
      insertedText = ` ${buildProperty("", "")} `;
    }
    edits.push({ startPos: insertAt, endPos: insertAt, insertedText });
  };

  const seenConfigs = new Set<number>();
  for (const config of configObjects) {
    const start = config.range().start.index;
    if (seenConfigs.has(start)) continue;
    seenConfigs.add(start);
    const experimentsValue = findPair(config, "experiments")?.field("value");
    if (experimentsValue) {
      if (experimentsValue.kind() !== "object") continue;
      if (findPair(experimentsValue, "css")) continue;
      insertIntoObject(experimentsValue, () => "css: true");
    } else {
      insertIntoObject(config, (indent, indentUnit) =>
        indent || indentUnit
          ? `experiments: {\n${indent}${indentUnit}css: true,\n${indent}}`
          : "experiments: { css: true }",
      );
    }
  }

  return rootNode.commitEdits(edits);
}

export default transform;

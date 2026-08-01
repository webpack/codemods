import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { Edit, SgNode, SgRoot } from "@codemod.com/jssg-types/main";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
// Rules whose `test` targets a preprocessor still need their loaders — skip them.
const PREPROCESSOR_TEST = /s[ac]ss|less|styl/;

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

  const isRemovableLoaderValue = (node: SgNode<Js>): boolean => {
    if (node.kind() === "string") return REMOVABLE_LOADERS.has(unquote(node.text()));
    return isPluginLoaderExpression(node);
  };

  // A `use` array entry replaceable by native CSS: a known loader string,
  // the plugin's `.loader`, or `{ loader: <one of those>, ... }`.
  const isRemovableUseElement = (node: SgNode<Js>): boolean => {
    if (isRemovableLoaderValue(node)) return true;
    if (node.kind() !== "object") return false;
    const loaderPair = findPair(node, "loader");
    if (!loaderPair) return false;
    const loaderValue = loaderPair.field("value");
    return loaderValue ? isRemovableLoaderValue(loaderValue) : false;
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
  interface RulesArrayWork {
    arrayNode: SgNode<Js>;
    removedElements: SgNode<Js>[];
    swappedUsePairs: SgNode<Js>[];
  }
  const rulesWork = new Map<number, RulesArrayWork>();

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "use") continue;
    const value = pair.field("value");
    if (!value) continue;
    const elements = value.kind() === "array" ? namedChildren(value) : [value];
    if (!elements.length || !elements.every(isRemovableUseElement)) continue;
    const ruleObject = pair.parent();
    if (!ruleObject || ruleObject.kind() !== "object") continue;
    const testValue = findPair(ruleObject, "test")?.field("value");
    if (testValue && PREPROCESSOR_TEST.test(testValue.text())) continue;
    const arrayNode = ruleObject.parent();
    const key = arrayNode ? arrayNode.range().start.index : rangeOf(pair).start;
    let work = rulesWork.get(key);
    if (!work && arrayNode) {
      work = { arrayNode, removedElements: [], swappedUsePairs: [] };
      rulesWork.set(key, work);
    }
    if (!work) continue;
    const trivialRule = pairsOf(ruleObject).every((rulePair) => {
      const name = keyName(rulePair);
      return name === "test" || name === "use";
    });
    if (trivialRule && arrayNode && arrayNode.kind() === "array") {
      work.removedElements.push(ruleObject);
    } else {
      work.swappedUsePairs.push(pair);
    }
  }

  for (const work of rulesWork.values()) {
    const allElements = namedChildren(work.arrayNode);
    if (
      work.removedElements.length === allElements.length &&
      !work.swappedUsePairs.length
    ) {
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
    for (const pair of work.swappedUsePairs) {
      edits.push(pair.replace('type: "css/auto"'));
      editedRanges.push(rangeOf(pair));
      const config = findConfigForRule(pair);
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

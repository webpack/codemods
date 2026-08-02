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

  // Loader name behind a `use` entry: a plain string, `require.resolve("...")`,
  // or `{ loader: <one of those> }`.
  const loaderNameOf = (node: SgNode<Js>): string | null => {
    if (node.kind() === "string") return unquote(node.text());
    if (node.kind() === "call_expression") {
      const resolved = /^require\.resolve\(\s*(["'`][^"'`]+["'`])\s*\)$/.exec(node.text());
      return resolved ? unquote(resolved[1]) : null;
    }
    if (node.kind() !== "object") return null;
    const loaderValue = findPair(node, "loader")?.field("value");
    return loaderValue ? loaderNameOf(loaderValue) : null;
  };

  // A `use` entry replaceable by native CSS: a known loader string, the
  // plugin's `.loader`, `{ loader: <one of those>, ... }`, or the classic
  // dev/prod ternary where both branches are replaceable.
  const isRemovableUseElement = (node: SgNode<Js>): boolean => {
    if (isPluginLoaderExpression(node)) return true;
    if (node.kind() === "ternary_expression") {
      const consequence = node.field("consequence");
      const alternative = node.field("alternative");
      return (
        consequence !== null &&
        alternative !== null &&
        isRemovableUseElement(consequence) &&
        isRemovableUseElement(alternative)
      );
    }
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

  // Per-config plan of properties to add once removals are known.
  interface ConfigPlan {
    config: SgNode<Js>;
    needsExperimentsCss: boolean;
    outputProps: { name: string; valueText: string }[];
  }
  const configPlans = new Map<number, ConfigPlan>();
  const planFor = (config: SgNode<Js>): ConfigPlan => {
    const key = config.range().start.index;
    let plan = configPlans.get(key);
    if (!plan) {
      plan = { config, needsExperimentsCss: false, outputProps: [] };
      configPlans.set(key, plan);
    }
    return plan;
  };

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

  const finalizeRemovals = (keepBracesOpenFor: Set<number>): void => {
    for (const { parent, removed } of pendingRemovals.values()) {
      const children = namedChildren(parent);
      if (children.every((child) => removed.has(child.range().start.index))) {
        if (keepBracesOpenFor.has(parent.range().start.index) && children.length) {
          // New properties will be inserted after "{" — clear the content only.
          const first = children[0].range().start.index;
          const lineStart = source.lastIndexOf("\n", first - 1) + 1;
          removeText({
            start: lineStart > parent.range().start.index ? lineStart : first,
            end: parent.range().end.index - 1,
          });
        } else {
          edits.push(parent.replace(parent.kind() === "array" ? "[]" : "{}"));
          editedRanges.push(rangeOf(parent));
        }
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
      if (config) planFor(config).needsExperimentsCss = true;
    }
  }

  // The `new MiniCssExtractPlugin(...)` behind a plugins element, unwrapping the
  // `isProd && new Plugin()` / `isDev ? false : new Plugin()` guard patterns.
  const pluginInstantiationOf = (element: SgNode<Js>): SgNode<Js> | null => {
    const candidates: (SgNode<Js> | null)[] = [element];
    if (element.kind() === "binary_expression" && element.field("operator")?.text() === "&&") {
      candidates.push(element.field("right"));
    }
    if (element.kind() === "ternary_expression") {
      candidates.push(element.field("consequence"), element.field("alternative"));
    }
    for (const candidate of candidates) {
      if (!candidate || candidate.kind() !== "new_expression") continue;
      const constructorNode = candidate.field("constructor");
      if (constructorNode && pluginNames.has(constructorNode.text())) return candidate;
    }
    return null;
  };

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "plugins") continue;
    let value = pair.field("value");
    // `plugins: [ ... ].filter(Boolean)` — operate on the inner array literal.
    if (value && value.kind() === "call_expression") {
      const callee = value.field("function");
      if (callee && callee.kind() === "member_expression") {
        const receiver = callee.field("object");
        if (receiver && receiver.kind() === "array") value = receiver;
      }
    }
    if (!value || value.kind() !== "array") continue;
    const elements = namedChildren(value);
    const removed = elements.filter((element) => pluginInstantiationOf(element) !== null);
    if (!removed.length) continue;
    // Only `filename`/`chunkFilename` have native counterparts; the rest of the
    // plugin options (ignoreOrder, insert, attributes, linkType, runtime) don't.
    const optionToOutput = new Map([
      ["filename", "cssFilename"],
      ["chunkFilename", "cssChunkFilename"],
    ]);
    const configObject = pair.parent();
    for (const element of removed) {
      if (!configObject || configObject.kind() !== "object") break;
      const argumentsNode = pluginInstantiationOf(element)?.field("arguments");
      const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
      if (!optionsObject || optionsObject.kind() !== "object") continue;
      const plan = planFor(configObject);
      for (const optionPair of pairsOf(optionsObject)) {
        const mapped = optionToOutput.get(keyName(optionPair) ?? "");
        const optionValue = optionPair.field("value");
        if (!mapped || !optionValue) continue;
        if (!plan.outputProps.some((prop) => prop.name === mapped)) {
          plan.outputProps.push({ name: mapped, valueText: optionValue.text() });
        }
      }
    }
    if (removed.length === elements.length) {
      markForRemoval(pair);
    } else {
      for (const element of removed) markForRemoval(element);
    }
  }

  // Decide which configs receive new top-level properties before removals are
  // finalized — a fully-emptied config keeps its braces open for them.
  interface InsertAction {
    target: SgNode<Js>;
    buildProperties: (indent: string, indentUnit: string) => string[];
  }
  const insertActions: InsertAction[] = [];
  const topInsertTargets = new Set<number>();

  for (const plan of configPlans.values()) {
    const topProperties: ((indent: string, unit: string) => string)[] = [];
    const experimentsValue = findPair(plan.config, "experiments")?.field("value");
    if (plan.needsExperimentsCss) {
      if (experimentsValue && experimentsValue.kind() === "object") {
        if (!findPair(experimentsValue, "css")) {
          insertActions.push({ target: experimentsValue, buildProperties: () => ["css: true"] });
        }
      } else if (!experimentsValue) {
        topProperties.push((indent, unit) =>
          indent || unit
            ? `experiments: {\n${indent}${unit}css: true,\n${indent}}`
            : "experiments: { css: true }",
        );
      }
    }
    if (plan.outputProps.length) {
      const outputValue = findPair(plan.config, "output")?.field("value");
      const propTexts = plan.outputProps.map((prop) => `${prop.name}: ${prop.valueText}`);
      if (outputValue && outputValue.kind() === "object") {
        const missing = plan.outputProps
          .filter((prop) => !findPair(outputValue, prop.name))
          .map((prop) => `${prop.name}: ${prop.valueText}`);
        if (missing.length) {
          insertActions.push({ target: outputValue, buildProperties: () => missing });
        }
      } else if (!outputValue) {
        topProperties.push((indent, unit) =>
          indent || unit
            ? `output: {\n${propTexts.map((text) => `${indent}${unit}${text}`).join(",\n")},\n${indent}}`
            : `output: { ${propTexts.join(", ")} }`,
        );
      }
    }
    if (topProperties.length) {
      topInsertTargets.add(plan.config.range().start.index);
      insertActions.push({
        target: plan.config,
        buildProperties: (indent, unit) => topProperties.map((build) => build(indent, unit)),
      });
    }
  }

  finalizeRemovals(topInsertTargets);

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

  // Insert properties right after an object's opening brace, matching its layout.
  const insertIntoObject = (
    objectNode: SgNode<Js>,
    buildProperties: (indent: string, indentUnit: string) => string[],
  ): void => {
    const insertAt = objectNode.range().start.index + 1;
    const properties = namedChildren(objectNode);
    const multiline = objectNode.text().includes("\n") && properties.length > 0;
    let insertedText: string;
    if (multiline) {
      const indent = lineIndent(source, properties[0].range().start.index);
      const indentUnit = indent.includes("\t") ? "\t" : indent || "  ";
      insertedText = buildProperties(indent, indentUnit)
        .map((property) => `\n${indent}${property},`)
        .join("");
    } else if (properties.length) {
      insertedText = ` ${buildProperties("", "").join(", ")},`;
    } else {
      insertedText = ` ${buildProperties("", "").join(", ")} `;
    }
    edits.push({ startPos: insertAt, endPos: insertAt, insertedText });
  };

  for (const action of insertActions) {
    insertIntoObject(action.target, action.buildProperties);
  }

  return rootNode.commitEdits(edits);
}

export default transform;

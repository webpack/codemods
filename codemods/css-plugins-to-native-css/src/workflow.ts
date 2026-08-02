import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { Edit, SgNode, SgRoot } from "@codemod.com/jssg-types/main";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
// Only `filename`/`chunkFilename` have native counterparts; the rest of the
// plugin options (ignoreOrder, insert, attributes, linkType, runtime) don't.
const PLUGIN_OPTION_TO_OUTPUT = new Map([
  ["filename", "cssFilename"],
  ["chunkFilename", "cssChunkFilename"],
]);

interface Range {
  start: number;
  end: number;
}

interface PluginBinding {
  name: string;
  statement: SgNode<Js>;
}

// Properties to add to one webpack config object once all removals are known.
interface ConfigPlan {
  config: SgNode<Js>;
  needsExperimentsCss: boolean;
  outputProps: { name: string; valueText: string }[];
}

interface UseSwap {
  pair: SgNode<Js>;
  ruleObject: SgNode<Js>;
  keptLoaders: SgNode<Js>[];
  filterSuffix: string;
}

interface RulesArrayWork {
  arrayNode: SgNode<Js>;
  removedElements: SgNode<Js>[];
  swaps: UseSwap[];
}

interface InsertAction {
  target: SgNode<Js>;
  buildProperties: (indent: string, indentUnit: string) => string[];
}

// ---------- generic AST helpers ----------

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

// `[ ... ].filter(<any predicate>)` — return the inner array literal.
function unwrapFilterCall(node: SgNode<Js>): SgNode<Js> {
  if (node.kind() !== "call_expression") return node;
  const callee = node.field("function");
  if (!callee || callee.kind() !== "member_expression") return node;
  if (callee.field("property")?.text() !== "filter") return node;
  const receiver = callee.field("object");
  return receiver && receiver.kind() === "array" ? receiver : node;
}

// The `.filter(...)` text that followed the array, e.g. `.filter((x) => !!x)`.
function filterSuffixOf(originalValue: SgNode<Js>, arrayNode: SgNode<Js>): string {
  if (originalValue.range().start.index === arrayNode.range().start.index) {
    return originalValue.text().slice(arrayNode.text().length);
  }
  return "";
}

// ---------- webpack-specific recognition ----------

// Loader name behind a `use` entry: a plain string, `require.resolve("...")`,
// or `{ loader: <one of those> }`.
function loaderNameOf(node: SgNode<Js>): string | null {
  if (node.kind() === "string") return unquote(node.text());
  if (node.kind() === "call_expression") {
    const resolved = /^require\.resolve\(\s*(["'`][^"'`]+["'`])\s*\)$/.exec(node.text());
    return resolved ? unquote(resolved[1]) : null;
  }
  if (node.kind() !== "object") return null;
  const loaderValue = findPair(node, "loader")?.field("value");
  return loaderValue ? loaderNameOf(loaderValue) : null;
}

// Whether the rule still claims plain `.css` resources after the transform —
// if so it disables the `experiments.css: "auto"` default, which then needs
// an explicit `true`. Unreadable conditions count as matching, to be safe.
function ruleMatchesCssFiles(ruleObject: SgNode<Js>): boolean {
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
}

// The enclosing webpack config object: nearest ancestor holding a `module` pair.
function findConfigForRule(node: SgNode<Js>): SgNode<Js> | null {
  let current = node.parent();
  while (current) {
    if (current.kind() === "pair" && keyName(current) === "module") {
      const parent = current.parent();
      if (parent && parent.kind() === "object") return parent;
    }
    current = current.parent();
  }
  return null;
}

class CssMigration {
  private readonly rootNode: SgNode<Js>;
  private readonly source: string;
  private readonly pluginBindings: PluginBinding[] = [];
  private readonly pluginNames: Set<string>;

  private readonly edits: Edit[] = [];
  private readonly editedRanges: Range[] = [];
  private readonly configPlans = new Map<number, ConfigPlan>();
  // Removals of comma-separated list items are grouped per parent container so
  // sibling removals in the same object/array never produce overlapping ranges.
  private readonly pendingRemovals = new Map<number, { parent: SgNode<Js>; removed: Set<number> }>();
  private readonly insertActions: InsertAction[] = [];
  // Fully-emptied objects that must keep their braces open for new properties.
  private readonly topInsertTargets = new Set<number>();

  constructor(root: SgRoot<Js>) {
    this.rootNode = root.root();
    this.source = this.rootNode.text();
    this.collectPluginBindings();
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
  }

  run(): string | null {
    this.transformRules();
    this.transformPlugins();
    this.planConfigInsertions();
    this.finalizeRemovals();
    if (!this.edits.length) return null;
    this.removeUnusedImports();
    for (const action of this.insertActions) {
      this.insertIntoObject(action.target, action.buildProperties);
    }
    return this.rootNode.commitEdits(this.edits);
  }

  // ---------- plugin import detection ----------

  private collectPluginBindings(): void {
    const importPatterns = [
      "const $NAME = require($SOURCE)",
      "let $NAME = require($SOURCE)",
      "var $NAME = require($SOURCE)",
      "import $NAME from $SOURCE",
    ];
    for (const pattern of importPatterns) {
      for (const statement of this.rootNode.findAll({ rule: { pattern } })) {
        const name = statement.getMatch("NAME");
        const moduleSource = statement.getMatch("SOURCE");
        if (!name || !moduleSource) continue;
        if (unquote(moduleSource.text()) !== PLUGIN_MODULE) continue;
        this.pluginBindings.push({ name: name.text(), statement });
      }
    }
  }

  // `MiniCssExtractPlugin.loader` or `require("mini-css-extract-plugin").loader`.
  private isPluginLoaderExpression(node: SgNode<Js>): boolean {
    if (node.kind() !== "member_expression") return false;
    const objectPart = node.field("object");
    const propertyPart = node.field("property");
    if (!objectPart || !propertyPart || propertyPart.text() !== "loader") return false;
    if (objectPart.kind() === "identifier") return this.pluginNames.has(objectPart.text());
    return (
      objectPart.kind() === "call_expression" &&
      /^require\(\s*["'`]mini-css-extract-plugin["'`]\s*\)$/.test(objectPart.text())
    );
  }

  // A `use` entry replaceable by native CSS: a known loader string, the
  // plugin's `.loader`, `{ loader: <one of those>, ... }`, or the dev/prod
  // `cond ? a : b` / `cond && a` forms where every branch is replaceable.
  private isRemovableUseElement(node: SgNode<Js>): boolean {
    if (this.isPluginLoaderExpression(node)) return true;
    if (node.kind() === "binary_expression" && node.field("operator")?.text() === "&&") {
      const right = node.field("right");
      return right !== null && this.isRemovableUseElement(right);
    }
    if (node.kind() === "ternary_expression") {
      const consequence = node.field("consequence");
      const alternative = node.field("alternative");
      return (
        consequence !== null &&
        alternative !== null &&
        this.isRemovableUseElement(consequence) &&
        this.isRemovableUseElement(alternative)
      );
    }
    if (node.kind() === "object") {
      const loaderValue = findPair(node, "loader")?.field("value");
      if (loaderValue && this.isPluginLoaderExpression(loaderValue)) return true;
    }
    const name = loaderNameOf(node);
    return name !== null && REMOVABLE_LOADERS.has(name);
  }

  // The `new MiniCssExtractPlugin(...)` behind a plugins element, unwrapping
  // the `isProd && new Plugin()` / `isDev ? false : new Plugin()` guards.
  private pluginInstantiationOf(element: SgNode<Js>): SgNode<Js> | null {
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
      if (constructorNode && this.pluginNames.has(constructorNode.text())) return candidate;
    }
    return null;
  }

  // ---------- module.rules ----------

  // Rules holding only `test` + `use` are dropped outright: with no user rule
  // matching `.css`, `experiments.css: "auto"` enables native CSS by itself.
  // Rules that must stay get `type: "css/auto"` (plus `experiments.css: true`
  // when they match `.css`, since their presence disables the "auto" default).
  private transformRules(): void {
    const rulesWork = this.collectRulesWork();
    for (const work of rulesWork.values()) {
      const allElements = namedChildren(work.arrayNode);
      if (work.removedElements.length === allElements.length && !work.swaps.length) {
        this.markForRemoval(this.escalateEmptyRulesArray(work.arrayNode));
        continue;
      }
      for (const element of work.removedElements) {
        this.markForRemoval(element);
      }
      for (const swap of work.swaps) {
        this.replaceUsePair(swap);
      }
    }
  }

  private collectRulesWork(): Map<number, RulesArrayWork> {
    const rulesWork = new Map<number, RulesArrayWork>();
    for (const pair of this.rootNode.findAll({ rule: { kind: "pair" } })) {
      if (keyName(pair) !== "use") continue;
      const originalValue = pair.field("value");
      if (!originalValue) continue;
      const value = unwrapFilterCall(originalValue);
      const elements = value.kind() === "array" ? namedChildren(value) : [value];
      if (!elements.length) continue;
      const removable = elements.filter((element) => this.isRemovableUseElement(element));
      // Any other loader (preprocessors, custom ones) stays in front of native CSS.
      const kept = elements.filter((element) => !this.isRemovableUseElement(element));
      if (!removable.length) continue;
      const ruleObject = pair.parent();
      if (!ruleObject || ruleObject.kind() !== "object") continue;
      const arrayNode = ruleObject.parent();
      if (!arrayNode) continue;
      const key = arrayNode.range().start.index;
      let work = rulesWork.get(key);
      if (!work) {
        work = { arrayNode, removedElements: [], swaps: [] };
        rulesWork.set(key, work);
      }
      const trivialRule = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);
        return name === "test" || name === "use";
      });
      if (trivialRule && !kept.length && arrayNode.kind() === "array") {
        work.removedElements.push(ruleObject);
      } else {
        work.swaps.push({
          pair,
          ruleObject,
          keptLoaders: kept,
          filterSuffix: filterSuffixOf(originalValue, value),
        });
      }
    }
    return rulesWork;
  }

  // The whole rules array goes away — cascade to `rules`/`module` when empty.
  private escalateEmptyRulesArray(arrayNode: SgNode<Js>): SgNode<Js> {
    const rulesPair = arrayNode.parent();
    if (!rulesPair || rulesPair.kind() !== "pair") return arrayNode;
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
      return modulePair;
    }
    return rulesPair;
  }

  private replaceUsePair(swap: UseSwap): void {
    if (swap.keptLoaders.length) {
      // Kept loaders stay in `use`; native CSS parses their output. Guarded
      // entries keep the original `.filter(...)` that drops their falsy branch.
      const keptTexts = swap.keptLoaders.map((loader) => loader.text());
      const keepsGuard = swap.keptLoaders.some(
        (loader) =>
          loader.kind() === "binary_expression" || loader.kind() === "ternary_expression",
      );
      const filterSuffix = keepsGuard ? swap.filterSuffix || ".filter(Boolean)" : "";
      const indent = lineIndent(this.source, swap.pair.range().start.index);
      const separator = swap.ruleObject.text().includes("\n") ? `,\n${indent}` : ", ";
      this.edits.push(
        swap.pair.replace(
          `use: [${keptTexts.join(", ")}]${filterSuffix}${separator}type: "css/auto"`,
        ),
      );
    } else {
      this.edits.push(swap.pair.replace('type: "css/auto"'));
    }
    this.editedRanges.push(rangeOf(swap.pair));
    // A surviving rule that matches `.css` turns the "auto" default off.
    if (!ruleMatchesCssFiles(swap.ruleObject)) return;
    const config = findConfigForRule(swap.pair);
    if (config) this.planFor(config).needsExperimentsCss = true;
  }

  // ---------- plugins ----------

  private transformPlugins(): void {
    for (const pair of this.rootNode.findAll({ rule: { kind: "pair" } })) {
      if (keyName(pair) !== "plugins") continue;
      let value = pair.field("value");
      if (value) value = unwrapFilterCall(value);
      if (!value || value.kind() !== "array") continue;
      const elements = namedChildren(value);
      const removed = elements.filter((element) => this.pluginInstantiationOf(element) !== null);
      if (!removed.length) continue;
      this.collectPluginOptions(pair, removed);
      if (removed.length === elements.length) {
        this.markForRemoval(pair);
      } else {
        for (const element of removed) this.markForRemoval(element);
      }
    }
  }

  private collectPluginOptions(pluginsPair: SgNode<Js>, removed: SgNode<Js>[]): void {
    const configObject = pluginsPair.parent();
    if (!configObject || configObject.kind() !== "object") return;
    for (const element of removed) {
      const argumentsNode = this.pluginInstantiationOf(element)?.field("arguments");
      const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
      if (!optionsObject || optionsObject.kind() !== "object") continue;
      const plan = this.planFor(configObject);
      for (const optionPair of pairsOf(optionsObject)) {
        const mapped = PLUGIN_OPTION_TO_OUTPUT.get(keyName(optionPair) ?? "");
        const optionValue = optionPair.field("value");
        if (!mapped || !optionValue) continue;
        if (!plan.outputProps.some((prop) => prop.name === mapped)) {
          plan.outputProps.push({ name: mapped, valueText: optionValue.text() });
        }
      }
    }
  }

  // ---------- config-level insertions ----------

  private planFor(config: SgNode<Js>): ConfigPlan {
    const key = config.range().start.index;
    let plan = this.configPlans.get(key);
    if (!plan) {
      plan = { config, needsExperimentsCss: false, outputProps: [] };
      this.configPlans.set(key, plan);
    }
    return plan;
  }

  private planConfigInsertions(): void {
    for (const plan of this.configPlans.values()) {
      const topProperties: ((indent: string, unit: string) => string)[] = [];
      this.planExperimentsCss(plan, topProperties);
      this.planOutputProps(plan, topProperties);
      if (topProperties.length) {
        this.topInsertTargets.add(plan.config.range().start.index);
        this.insertActions.push({
          target: plan.config,
          buildProperties: (indent, unit) => topProperties.map((build) => build(indent, unit)),
        });
      }
    }
  }

  private planExperimentsCss(
    plan: ConfigPlan,
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    if (!plan.needsExperimentsCss) return;
    const experimentsValue = findPair(plan.config, "experiments")?.field("value");
    if (experimentsValue && experimentsValue.kind() === "object") {
      if (!findPair(experimentsValue, "css")) {
        this.insertActions.push({ target: experimentsValue, buildProperties: () => ["css: true"] });
      }
    } else if (!experimentsValue) {
      topProperties.push((indent, unit) =>
        indent || unit
          ? `experiments: {\n${indent}${unit}css: true,\n${indent}}`
          : "experiments: { css: true }",
      );
    }
  }

  private planOutputProps(
    plan: ConfigPlan,
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    if (!plan.outputProps.length) return;
    const outputValue = findPair(plan.config, "output")?.field("value");
    const propTexts = plan.outputProps.map((prop) => `${prop.name}: ${prop.valueText}`);
    if (outputValue && outputValue.kind() === "object") {
      const missing = plan.outputProps
        .filter((prop) => !findPair(outputValue, prop.name))
        .map((prop) => `${prop.name}: ${prop.valueText}`);
      if (missing.length) {
        this.insertActions.push({ target: outputValue, buildProperties: () => missing });
      }
    } else if (!outputValue) {
      topProperties.push((indent, unit) =>
        indent || unit
          ? `output: {\n${propTexts.map((text) => `${indent}${unit}${text}`).join(",\n")},\n${indent}}`
          : `output: { ${propTexts.join(", ")} }`,
      );
    }
  }

  // Insert properties right after an object's opening brace, matching its layout.
  private insertIntoObject(
    objectNode: SgNode<Js>,
    buildProperties: (indent: string, indentUnit: string) => string[],
  ): void {
    const insertAt = objectNode.range().start.index + 1;
    const properties = namedChildren(objectNode);
    const multiline = objectNode.text().includes("\n") && properties.length > 0;
    let insertedText: string;
    if (multiline) {
      const indent = lineIndent(this.source, properties[0].range().start.index);
      const indentUnit = indent.includes("\t") ? "\t" : indent || "  ";
      insertedText = buildProperties(indent, indentUnit)
        .map((property) => `\n${indent}${property},`)
        .join("");
    } else if (properties.length) {
      insertedText = ` ${buildProperties("", "").join(", ")},`;
    } else {
      insertedText = ` ${buildProperties("", "").join(", ")} `;
    }
    this.edits.push({ startPos: insertAt, endPos: insertAt, insertedText });
  }

  // ---------- removals ----------

  private removeText(range: Range): void {
    this.edits.push({ startPos: range.start, endPos: range.end, insertedText: "" });
    this.editedRanges.push(range);
  }

  private markForRemoval(node: SgNode<Js>): void {
    const parent = node.parent();
    if (!parent) return;
    const key = parent.range().start.index;
    let group = this.pendingRemovals.get(key);
    if (!group) {
      group = { parent, removed: new Set() };
      this.pendingRemovals.set(key, group);
    }
    group.removed.add(node.range().start.index);
  }

  private finalizeRemovals(): void {
    for (const { parent, removed } of this.pendingRemovals.values()) {
      const children = namedChildren(parent);
      if (children.every((child) => removed.has(child.range().start.index))) {
        this.clearContainer(parent, children);
        continue;
      }
      this.removeChildRuns(children, removed);
    }
  }

  private clearContainer(parent: SgNode<Js>, children: SgNode<Js>[]): void {
    if (this.topInsertTargets.has(parent.range().start.index) && children.length) {
      // New properties will be inserted after "{" — clear the content only.
      const first = children[0].range().start.index;
      const lineStart = this.source.lastIndexOf("\n", first - 1) + 1;
      this.removeText({
        start: lineStart > parent.range().start.index ? lineStart : first,
        end: parent.range().end.index - 1,
      });
    } else {
      this.edits.push(parent.replace(parent.kind() === "array" ? "[]" : "{}"));
      this.editedRanges.push(rangeOf(parent));
    }
  }

  // Delete each contiguous run of removed children up to the next kept
  // sibling, or back to the previous kept one for a trailing run.
  private removeChildRuns(children: SgNode<Js>[], removed: Set<number>): void {
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
        this.removeText({
          start: children[index].range().start.index,
          end: next.range().start.index,
        });
      } else {
        this.removeText({
          start: children[index - 1].range().end.index,
          end: children[runEnd].range().end.index,
        });
      }
      index = runEnd + 1;
    }
  }

  // ---------- imports ----------

  // Drop the plugin import once no reference survives outside the edited ranges.
  private removeUnusedImports(): void {
    for (const binding of this.pluginBindings) {
      const statementRange = rangeOf(binding.statement);
      const survivingReference = this.rootNode
        .findAll({ rule: { kind: "identifier" } })
        .some((identifier) => {
          if (identifier.text() !== binding.name) return false;
          const range = rangeOf(identifier);
          if (range.start >= statementRange.start && range.end <= statementRange.end) return false;
          return !isInsideAny(range, this.editedRanges);
        });
      if (survivingReference) continue;
      let end = statementRange.end;
      if (this.source[end] === "\r") end += 1;
      if (this.source[end] === "\n") end += 1;
      // At the top of the file also swallow the blank line that separated it.
      while (
        statementRange.start === 0 &&
        (this.source[end] === "\n" || this.source[end] === "\r")
      ) {
        end += 1;
      }
      this.edits.push({ startPos: statementRange.start, endPos: end, insertedText: "" });
    }
  }
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  return new CssMigration(root).run();
}

export default transform;

import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  collectModuleBindings,
  filterSuffixOf,
  findConfigObjectFor,
  findPair,
  keyName,
  lineIndent,
  loaderNameOf,
  namedChildren,
  pairsOf,
  ruleMatchesFiles,
  unwrapFilterCall,
} from "@webpack/codemod-utils";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
// Only `filename`/`chunkFilename` have native counterparts; the rest of the
// plugin options (ignoreOrder, insert, attributes, linkType, runtime) don't.
const PLUGIN_OPTION_TO_OUTPUT = new Map([
  ["filename", "cssFilename"],
  ["chunkFilename", "cssChunkFilename"],
]);
const CSS_SAMPLE_FILES = ["/file.css", "/file.module.css"];

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

class CssMigration {
  private readonly editor: ConfigEditor;
  private readonly pluginBindings: ModuleBinding[];
  private readonly pluginNames: Set<string>;

  private readonly configPlans = new Map<number, ConfigPlan>();
  private readonly insertActions: InsertAction[] = [];

  constructor(root: SgRoot<Js>) {
    this.editor = new ConfigEditor(root.root());
    this.pluginBindings = collectModuleBindings(this.editor.rootNode, PLUGIN_MODULE);
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
  }

  run(): string | null {
    this.transformRules();
    this.transformPlugins();
    this.planConfigInsertions();
    this.editor.finalizeRemovals();
    if (!this.editor.hasEdits) return null;
    for (const binding of this.pluginBindings) {
      this.editor.removeBindingIfUnused(binding);
    }
    for (const action of this.insertActions) {
      this.editor.insertIntoObject(action.target, action.buildProperties);
    }
    return this.editor.commit();
  }

  // ---------- plugin recognition ----------

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

  // A `use` entry configuring css-loader's `modules` option (any value —
  // `false` differs from the `css/auto` naming convention too).
  private hasCssModulesOption(node: SgNode<Js>): boolean {
    if (node.kind() === "binary_expression") {
      const right = node.field("right");
      return right !== null && this.hasCssModulesOption(right);
    }
    if (node.kind() === "ternary_expression") {
      const consequence = node.field("consequence");
      const alternative = node.field("alternative");
      return (
        (consequence !== null && this.hasCssModulesOption(consequence)) ||
        (alternative !== null && this.hasCssModulesOption(alternative))
      );
    }
    if (node.kind() !== "object" || loaderNameOf(node) !== "css-loader") return false;
    const optionsValue = findPair(node, "options")?.field("value");
    if (!optionsValue || optionsValue.kind() !== "object") return false;
    return findPair(optionsValue, "modules") !== undefined;
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
        this.editor.markForRemoval(this.escalateEmptyRulesArray(work.arrayNode));
        continue;
      }
      for (const element of work.removedElements) {
        this.editor.markForRemoval(element);
      }
      for (const swap of work.swaps) {
        this.replaceUsePair(swap);
      }
    }
  }

  private collectRulesWork(): Map<number, RulesArrayWork> {
    const rulesWork = new Map<number, RulesArrayWork>();
    for (const pair of this.editor.rootNode.findAll({ rule: { kind: "pair" } })) {
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
      // css-loader's `modules` option applies to every matched file, while
      // `css/auto` only treats `*.module.*` names as CSS modules — migrating a
      // rule that also matches plain `.css` would silently change semantics.
      if (
        elements.some((element) => this.hasCssModulesOption(element)) &&
        ruleMatchesFiles(ruleObject, ["/file.css"])
      ) {
        continue;
      }
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
      const indent = lineIndent(this.editor.source, swap.pair.range().start.index);
      const separator = swap.ruleObject.text().includes("\n") ? `,\n${indent}` : ", ";
      this.editor.replace(
        swap.pair,
        `use: [${keptTexts.join(", ")}]${filterSuffix}${separator}type: "css/auto"`,
      );
    } else {
      this.editor.replace(swap.pair, 'type: "css/auto"');
    }
    // A surviving rule that matches `.css` turns the "auto" default off.
    if (!ruleMatchesFiles(swap.ruleObject, CSS_SAMPLE_FILES)) return;
    const config = findConfigObjectFor(swap.pair);
    if (config) this.planFor(config).needsExperimentsCss = true;
  }

  // ---------- plugins ----------

  private transformPlugins(): void {
    for (const pair of this.editor.rootNode.findAll({ rule: { kind: "pair" } })) {
      if (keyName(pair) !== "plugins") continue;
      let value = pair.field("value");
      if (value) value = unwrapFilterCall(value);
      if (!value || value.kind() !== "array") continue;
      const elements = namedChildren(value);
      const removed = elements.filter((element) => this.pluginInstantiationOf(element) !== null);
      if (!removed.length) continue;
      this.collectPluginOptions(pair, removed);
      if (removed.length === elements.length) {
        this.editor.markForRemoval(pair);
      } else {
        for (const element of removed) this.editor.markForRemoval(element);
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
        // A fully-emptied config keeps its braces open for these properties.
        this.editor.keepBracesOpen(plan.config);
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
        this.insertActions.push({
          target: experimentsValue,
          buildProperties: () => ["css: true"],
        });
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
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  return new CssMigration(root).run();
}

export default transform;

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
  requireCallSource,
  ruleMatchesFiles,
  unquote,
  unwrapFilterCall,
} from "@webpack/codemod-utils";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
// Plugin options with a native counterpart; the rest have none and are dropped.
const PLUGIN_OPTION_TO_OUTPUT = new Map([
  ["filename", "cssFilename"],
  ["chunkFilename", "cssChunkFilename"],
]);
const CSS_SAMPLE_FILES = ["/file.css", "/file.module.css"];
// Options native CSS covers on its own; any other option is flagged when dropped.
const DROPPABLE_CSS_LOADER_OPTIONS = new Set(["importLoaders", "sourceMap", "esModule"]);
const DROPPABLE_INJECTION_LOADER_OPTIONS = new Set(["esModule"]);

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
  lostOptions: string[];
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

  // The plugin's `.loader` in any access form: `MiniCssExtractPlugin.loader`,
  // `MiniCssExtractPlugin["loader"]`, or `require("mini-css-extract-plugin").loader`.
  private isPluginLoaderExpression(node: SgNode<Js>): boolean {
    let objectPart: SgNode<Js> | null = null;
    if (node.kind() === "member_expression") {
      if (node.field("property")?.text() !== "loader") return false;
      objectPart = node.field("object");
    } else if (node.kind() === "subscript_expression") {
      const indexPart = node.field("index");
      if (!indexPart || indexPart.kind() !== "string" || unquote(indexPart.text()) !== "loader") {
        return false;
      }
      objectPart = node.field("object");
    }
    if (!objectPart) return false;
    if (objectPart.kind() === "identifier") return this.pluginNames.has(objectPart.text());
    return requireCallSource(objectPart) === PLUGIN_MODULE;
  }

  // A `use` entry replaceable by native CSS, unwrapping dev/prod guards.
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

  // Dropped options native CSS cannot replicate, qualified per loader;
  // `modules` counts only when the rule also matches plain `.css` files.
  private lostLoaderOptions(node: SgNode<Js>, ruleObject: SgNode<Js>): string[] {
    if (node.kind() === "binary_expression") {
      const right = node.field("right");
      return right ? this.lostLoaderOptions(right, ruleObject) : [];
    }
    if (node.kind() === "ternary_expression") {
      const consequence = node.field("consequence");
      const alternative = node.field("alternative");
      return [
        ...(consequence ? this.lostLoaderOptions(consequence, ruleObject) : []),
        ...(alternative ? this.lostLoaderOptions(alternative, ruleObject) : []),
      ];
    }
    if (node.kind() !== "object") return [];
    const loaderValue = findPair(node, "loader")?.field("value");
    const isExtractLoader = Boolean(loaderValue && this.isPluginLoaderExpression(loaderValue));
    const loaderName = isExtractLoader ? "MiniCssExtractPlugin.loader" : loaderNameOf(node);
    if (!loaderName) return [];
    if (!isExtractLoader && loaderName !== "css-loader" && loaderName !== "style-loader") {
      return [];
    }
    const droppable =
      loaderName === "css-loader"
        ? DROPPABLE_CSS_LOADER_OPTIONS
        : DROPPABLE_INJECTION_LOADER_OPTIONS;
    const optionsPair = findPair(node, "options");
    if (!optionsPair) return [];
    const optionsValue = optionsPair.field("value");
    if (!optionsValue || optionsValue.kind() !== "object") return [`${loaderName}.options`];
    const lost: string[] = [];
    for (const optionPair of pairsOf(optionsValue)) {
      const name = keyName(optionPair);
      if (loaderName === "css-loader" && name === "modules") {
        if (ruleMatchesFiles(ruleObject, ["/file.css"])) lost.push(`${loaderName}.${name}`);
      } else if (name === null || !droppable.has(name)) {
        lost.push(`${loaderName}.${name ?? "options"}`);
      }
    }
    return lost;
  }

  // The plugin instantiation behind a plugins element, unwrapping guards.
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

  // Trivial rules are dropped (the `experiments.css: "auto"` default takes
  // over); surviving rules get `type: "css/auto"`.
  private transformRules(): void {
    const rulesWork = this.collectRulesWork();
    for (const work of rulesWork.values()) {
      const allElements = namedChildren(work.arrayNode);
      if (work.removedElements.length === allElements.length && !work.swaps.length) {
        this.editor.markForRemoval(this.cascadeRemovalTarget(work.arrayNode));
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
      const arrayNode = ruleObject.parent();
      // Only touch rules the file demonstrably owns as webpack config — never
      // fragments pushed into another tool's config (Storybook, craco, …).
      if (!arrayNode || arrayNode.kind() !== "array") continue;
      if (!this.isWebpackRuleContext(pair, arrayNode)) continue;
      const lostOptions = [
        ...new Set(elements.flatMap((element) => this.lostLoaderOptions(element, ruleObject))),
      ];
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
      // A rule with lost options stays as a swap so the comment has a home.
      if (trivialRule && !kept.length && !lostOptions.length) {
        work.removedElements.push(ruleObject);
      } else {
        work.swaps.push({
          pair,
          ruleObject,
          keptLoaders: kept,
          filterSuffix: filterSuffixOf(originalValue, value),
          lostOptions,
        });
      }
    }
    return rulesWork;
  }

  // Webpack owns the rule when its array hangs on a `rules`/`oneOf` pair, the
  // config has a `module` ancestor, or the file imports the extract plugin.
  private isWebpackRuleContext(usePair: SgNode<Js>, arrayNode: SgNode<Js>): boolean {
    const listPair = arrayNode.parent();
    if (listPair && listPair.kind() === "pair") {
      const name = keyName(listPair);
      if (name === "rules" || name === "oneOf") return true;
    }
    if (this.pluginNames.size > 0) return true;
    return findConfigObjectFor(usePair) !== null;
  }

  // Climb while the removal would leave an empty container behind, so a
  // css-only `oneOf` → rule → `rules` → `module` chain collapses as one removal.
  private cascadeRemovalTarget(node: SgNode<Js>): SgNode<Js> {
    let target = node;
    for (;;) {
      const parent = target.parent();
      if (!parent) return target;
      if (parent.kind() === "pair") {
        target = parent;
        continue;
      }
      if (parent.kind() !== "object" && parent.kind() !== "array") return target;
      const members = parent.kind() === "object" ? pairsOf(parent) : namedChildren(parent);
      if (members.length !== 1) return target;
      const grandparent = parent.parent();
      if (!grandparent || (grandparent.kind() !== "pair" && grandparent.kind() !== "array")) {
        return target;
      }
      target = parent;
    }
  }

  private replaceUsePair(swap: UseSwap): void {
    const indent = lineIndent(this.editor.source, swap.pair.range().start.index);
    const multiline = swap.ruleObject.text().includes("\n");
    // Flag dropped loader options right where they lived.
    let commentPrefix = "";
    if (swap.lostOptions.length) {
      const message = `Removed loader options without a native CSS equivalent: ${swap.lostOptions.join(", ")}`;
      commentPrefix = multiline ? `// ${message}\n${indent}` : `/* ${message} */ `;
    }
    if (swap.keptLoaders.length) {
      // Guarded entries keep the original `.filter(...)` for their falsy branch.
      const keptTexts = swap.keptLoaders.map((loader) => loader.text());
      const keepsGuard = swap.keptLoaders.some(
        (loader) =>
          loader.kind() === "binary_expression" || loader.kind() === "ternary_expression",
      );
      const filterSuffix = keepsGuard ? swap.filterSuffix || ".filter(Boolean)" : "";
      const separator = multiline ? `,\n${indent}` : ", ";
      this.editor.replace(
        swap.pair,
        `${commentPrefix}use: [${keptTexts.join(", ")}]${filterSuffix}${separator}type: "css/auto"`,
      );
    } else {
      this.editor.replace(swap.pair, `${commentPrefix}type: "css/auto"`);
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

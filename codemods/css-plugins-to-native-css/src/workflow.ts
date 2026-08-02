import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  cascadeRemovalTarget,
  collectModuleBindings,
  filterSuffixOf,
  findConfigObjectFor,
  findPair,
  guardBranchesOf,
  keyName,
  lineIndent,
  loaderNameOf,
  namedChildren,
  pairsOf,
  ruleMatchesFiles,
  unquote,
  unwrapFilterCall,
} from "@webpack/codemod-utils";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
const EXTRACT_LOADER_NAME = "MiniCssExtractPlugin.loader";
// Plugin options with a native counterpart; the rest have none and are dropped.
const PLUGIN_OPTION_TO_OUTPUT = new Map([
  ["filename", "cssFilename"],
  ["chunkFilename", "cssChunkFilename"],
]);
const CSS_SAMPLE_FILES = ["/file.css", "/file.module.css"];
const PLAIN_CSS_SAMPLE = ["/file.css"];
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

interface PluginRemoval {
  element: SgNode<Js>;
  instantiation: SgNode<Js>;
}

class CssMigration {
  private readonly editor: ConfigEditor;
  private readonly pluginBindings: ModuleBinding[];
  private readonly pluginNames: Set<string>;

  private readonly configPlans = new Map<number, ConfigPlan>();

  constructor(root: SgRoot<Js>) {
    this.editor = new ConfigEditor(root.root());
    this.pluginBindings = collectModuleBindings(this.editor.rootNode, PLUGIN_MODULE);
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
  }

  run(): string | null {
    const usePairs: SgNode<Js>[] = [];
    const pluginsPairs: SgNode<Js>[] = [];
    for (const pair of this.editor.rootNode.findAll({ rule: { kind: "pair" } })) {
      const name = keyName(pair);
      if (name === "use") usePairs.push(pair);
      else if (name === "plugins") pluginsPairs.push(pair);
    }
    this.transformRules(usePairs);
    this.transformPlugins(pluginsPairs);
    this.planConfigInsertions();
    this.editor.finalizeRemovals();
    if (!this.editor.hasEdits) return null;
    for (const binding of this.pluginBindings) {
      this.editor.removeBindingIfUnused(binding);
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
    return this.isInlinePluginRequire(objectPart);
  }

  // An inline `require("mini-css-extract-plugin")` call expression.
  private isInlinePluginRequire(node: SgNode<Js>): boolean {
    if (node.kind() !== "call_expression") return false;
    const callee = node.field("function");
    if (!callee || callee.kind() !== "identifier" || callee.text() !== "require") return false;
    const argumentsNode = node.field("arguments");
    const args = argumentsNode ? namedChildren(argumentsNode) : [];
    return (
      args.length === 1 && args[0].kind() === "string" && unquote(args[0].text()) === PLUGIN_MODULE
    );
  }

  // A `use` entry replaceable by native CSS, unwrapping dev/prod guards.
  private isRemovableUseElement(node: SgNode<Js>): boolean {
    const branches = guardBranchesOf(node);
    if (branches) {
      return branches.length > 0 && branches.every((branch) => this.isRemovableUseElement(branch));
    }
    if (this.isPluginLoaderExpression(node)) return true;
    if (node.kind() === "object") {
      const loaderValue = findPair(node, "loader")?.field("value");
      if (!loaderValue) return false;
      if (this.isPluginLoaderExpression(loaderValue)) return true;
      const name = loaderNameOf(loaderValue);
      return name !== null && REMOVABLE_LOADERS.has(name);
    }
    const name = loaderNameOf(node);
    return name !== null && REMOVABLE_LOADERS.has(name);
  }

  // Dropped options native CSS cannot replicate, qualified per loader;
  // `modules` counts only when the rule also matches plain `.css` files.
  private lostLoaderOptions(node: SgNode<Js>, ruleObject: SgNode<Js>): string[] {
    const branches = guardBranchesOf(node);
    if (branches) {
      return branches.flatMap((branch) => this.lostLoaderOptions(branch, ruleObject));
    }
    if (node.kind() !== "object") return [];
    const loaderValue = findPair(node, "loader")?.field("value");
    const isExtractLoader = Boolean(loaderValue && this.isPluginLoaderExpression(loaderValue));
    const loaderName = isExtractLoader ? EXTRACT_LOADER_NAME : loaderNameOf(node);
    if (!loaderName) return [];
    if (!isExtractLoader && !REMOVABLE_LOADERS.has(loaderName)) return [];
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
        if (ruleMatchesFiles(ruleObject, PLAIN_CSS_SAMPLE)) lost.push(`${loaderName}.${name}`);
      } else if (name === null || !droppable.has(name)) {
        lost.push(`${loaderName}.${name ?? "options"}`);
      }
    }
    return lost;
  }

  // The plugin instantiation behind a plugins element, unwrapping guards.
  private pluginInstantiationOf(element: SgNode<Js>): SgNode<Js> | null {
    const branches = guardBranchesOf(element);
    if (branches) {
      for (const branch of branches) {
        const found = this.pluginInstantiationOf(branch);
        if (found) return found;
      }
      return null;
    }
    if (element.kind() !== "new_expression") return null;
    const constructorNode = element.field("constructor");
    return constructorNode && this.pluginNames.has(constructorNode.text()) ? element : null;
  }

  // ---------- module.rules ----------

  // Trivial rules are dropped (the `experiments.css: "auto"` default takes
  // over); surviving rules get `type: "css/auto"`.
  private transformRules(usePairs: SgNode<Js>[]): void {
    const rulesWork = this.collectRulesWork(usePairs);
    for (const work of rulesWork.values()) {
      const allElements = namedChildren(work.arrayNode);
      if (work.removedElements.length === allElements.length && !work.swaps.length) {
        this.editor.markForRemoval(cascadeRemovalTarget(work.arrayNode));
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

  private collectRulesWork(usePairs: SgNode<Js>[]): Map<number, RulesArrayWork> {
    const rulesWork = new Map<number, RulesArrayWork>();
    for (const pair of usePairs) {
      const originalValue = pair.field("value");
      if (!originalValue) continue;
      const value = unwrapFilterCall(originalValue);
      const elements = value.kind() === "array" ? namedChildren(value) : [value];
      if (!elements.length) continue;
      // Any other loader (preprocessors, custom ones) stays in front of native CSS.
      const kept = elements.filter((element) => !this.isRemovableUseElement(element));
      if (kept.length === elements.length) continue;
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
    const owner = arrayNode.parent();
    if (owner && owner.kind() === "pair") {
      const name = keyName(owner);
      if (name === "rules" || name === "oneOf") return true;
    }
    // Assignments into another tool's mutable config parameter
    // (`config.module.rules = [...]` in next.config, Storybook, …) are not ours.
    if (
      owner &&
      owner.kind() === "assignment_expression" &&
      owner.field("left")?.text() !== "module.exports"
    ) {
      return false;
    }
    if (this.pluginNames.size > 0) return true;
    return findConfigObjectFor(usePair) !== null;
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
      const keepsGuard = swap.keptLoaders.some((loader) => guardBranchesOf(loader) !== null);
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

  private transformPlugins(pluginsPairs: SgNode<Js>[]): void {
    for (const pair of pluginsPairs) {
      const originalValue = pair.field("value");
      if (!originalValue) continue;
      const value = unwrapFilterCall(originalValue);
      if (value.kind() !== "array") continue;
      const elements = namedChildren(value);
      const removed: PluginRemoval[] = [];
      for (const element of elements) {
        const instantiation = this.pluginInstantiationOf(element);
        if (instantiation) removed.push({ element, instantiation });
      }
      if (!removed.length) continue;
      this.collectPluginOptions(pair, removed);
      if (removed.length === elements.length) {
        this.editor.markForRemoval(pair);
      } else {
        for (const removal of removed) this.editor.markForRemoval(removal.element);
      }
    }
  }

  private collectPluginOptions(pluginsPair: SgNode<Js>, removed: PluginRemoval[]): void {
    const configObject = pluginsPair.parent();
    if (!configObject || configObject.kind() !== "object") return;
    for (const removal of removed) {
      const argumentsNode = removal.instantiation.field("arguments");
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
      if (plan.needsExperimentsCss) {
        this.planObjectProps(plan.config, "experiments", [{ name: "css", valueText: "true" }], topProperties);
      }
      if (plan.outputProps.length) {
        this.planObjectProps(plan.config, "output", plan.outputProps, topProperties);
      }
      if (topProperties.length) {
        // A fully-emptied config keeps its braces open for these properties.
        this.editor.keepBracesOpen(plan.config);
        this.editor.insertIntoObject(plan.config, (indent, unit) =>
          topProperties.map((build) => build(indent, unit)),
        );
      }
    }
  }

  // Insert props into the config's `key` object, creating it when absent; an
  // existing non-object value (e.g. a variable) is left alone.
  private planObjectProps(
    config: SgNode<Js>,
    key: string,
    props: { name: string; valueText: string }[],
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    const value = findPair(config, key)?.field("value");
    if (value && value.kind() === "object") {
      const missing = props
        .filter((prop) => !findPair(value, prop.name))
        .map((prop) => `${prop.name}: ${prop.valueText}`);
      if (missing.length) this.editor.insertIntoObject(value, () => missing);
    } else if (!value) {
      topProperties.push((indent, unit) => {
        const texts = props.map((prop) => `${prop.name}: ${prop.valueText}`);
        return indent || unit
          ? `${key}: {\n${texts.map((text) => `${indent}${unit}${text}`).join(",\n")},\n${indent}}`
          : `${key}: { ${texts.join(", ")} }`;
      });
    }
  }
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  return new CssMigration(root).run();
}

export default transform;

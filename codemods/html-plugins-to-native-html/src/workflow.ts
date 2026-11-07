import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  addImport,
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
import { collectMinification, planMinification, type Minification } from "./minification";
import { queueTemplate, recordSource } from "./migration-state";
import { isIdentityCallback, nativeSources, nativeTemplate } from "./loader-options";
import { templateScriptTag } from "./templates";

const PLUGIN_MODULE = "html-webpack-plugin";
const LOADER_NAME = "html-loader";
const HTML_SAMPLE_FILES = ["/file.html"];
const DEFAULT_HTML_TESTS = new Set(["/\\.html$/", "/\\.html$/i"]);
// Native HTML defaults already covered by these plugin option values.
const HEAD_TAG_OPTIONS = new Set(["title", "meta", "favicon", "base"]);
// Build-ergonomics options with no effect on the emitted page.
const DROPPABLE_OPTIONS = new Set(["cache", "showErrors", "chunksSortMode"]);
// Manual migration paths appended to the review comment where one exists.
const LOST_OPTION_HINTS = new Map([
  ["publicPath", "set output.publicPath"],
  ["hash", "use [contenthash] in output.htmlFilename"],
  ["chunks", "use per-entry `html` descriptors"],
  ["excludeChunks", "use per-entry `html` descriptors"],
  ["scriptLoading", "module scripts come from output.module"],
  ["templateContent", "author the page as an .html entry file"],
]);

// Plugin hooks renamed to the native `HtmlModulesPlugin.getCompilationHooks`
// stage covering the same moment; arguments differ, hence the review comments.
const HOOK_RENAMES = new Map([
  ["alterAssetTags", "transformTags"],
  ["alterAssetTagGroups", "transformTags"],
  ["beforeEmit", "transformHtml"],
  ["afterEmit", "htmlEmitted"],
]);
const HOOK_REVIEW_COMMENTS = new Map([
  [
    "transformTags",
    "transformTags receives mutable tag descriptors (tags, { outputName, html }); mutate attrs/injectTo/remove, add tags via the injectTags hook",
  ],
  ["transformHtml", "transformHtml receives (html, { outputName }) and must return the html string"],
  ["htmlEmitted", "htmlEmitted receives ({ outputName }); nothing to return"],
]);
// Stages webpack handles itself — a tap on them cannot be carried over, so
// files using them are left untouched.
const UNMAPPABLE_HOOKS = new Set(["beforeAssetTagGeneration", "afterTemplateExecution"]);
// Handled by the per-entry migration itself rather than the option mapping.
const MULTI_PAGE_SKIPPED_OPTIONS = new Set(["chunks", "filename"]);
// Companion plugins that extended html-webpack-plugin; each maps to one
// `output.html` option. Only migrated alongside a migrated html-webpack-plugin.
const CSP_MODULE = "csp-html-webpack-plugin";
const SRI_MODULE = "webpack-subresource-integrity";
const FAVICONS_MODULE = "favicons-webpack-plugin";
const SIBLING_PLUGIN_MODULES = [CSP_MODULE, SRI_MODULE, FAVICONS_MODULE];

type PageMode = "single" | "template" | "multi";

interface HtmlProp {
  name: string;
  valueText: string;
}

function dedupeProps(props: HtmlProp[]): HtmlProp[] {
  const seen = new Set<string>();
  return props.filter((prop) => !seen.has(prop.name) && seen.add(prop.name));
}

function isRequireOf(node: SgNode<Js>, moduleName: string): boolean {
  if (!node.is("call_expression")) return false;
  const callee = node.field("function");
  if (!callee || !callee.is("identifier") || callee.text() !== "require") return false;
  const argumentsNode = node.field("arguments");
  const args = argumentsNode ? namedChildren(argumentsNode) : [];
  return args.length === 1 && args[0].is("string") && unquote(args[0].text()) === moduleName;
}

// Everything one plugin instance contributes to its enclosing config.
interface InstanceFindings {
  minification: Minification;
  htmlProps: HtmlProp[];
  htmlFilename: string | null;
  templateValue: string | null;
  lost: string[];
  notes: string[];
  // `entry` property to create when the config had none (template mode).
  pendingEntry: { text: string; comment: string } | null;
  // `scriptLoading: "module"` — ESM output, set config-wide.
  scriptLoadingModule: boolean;
}

// Loader options translated into the surviving rule and migration eligibility.
interface LoaderFindings {
  supported: boolean;
  sourceDefaults: boolean;
  parserProps: HtmlProp[];
  minification: Minification[];
}

interface RuleMigration {
  pair: SgNode<Js>;
  ruleObject: SgNode<Js>;
  kept: SgNode<Js>[];
  filterSuffix: string;
  findings: LoaderFindings;
  trivial: boolean;
  optionsPair: SgNode<Js> | null;
}

// Properties to add to one webpack config object once all removals are known.
interface ConfigPlan {
  config: SgNode<Js>;
  sourceDefaults: boolean;
  minification: Minification[];
  commentLines: string[];
  // Emit a global `output.html` (single-page mode; per-entry pages skip it).
  htmlEnabled: boolean;
  // Props composing the `output.html` object (plugin options, sibling plugins).
  htmlProps: HtmlProp[];
  htmlFilename: string | null;
  // Other output-level props (e.g. `module` for ESM script loading).
  outputProps: HtmlProp[];
  experimentsProps: HtmlProp[];
  pendingEntry: { text: string; comment: string } | null;
  // A html-webpack-plugin instance in this config was migrated.
  pluginMigratedHere: boolean;
}

class HtmlMigration {
  private readonly editor: ConfigEditor;
  private readonly pluginBindings;
  private readonly pluginNames: Set<string>;
  private readonly configPlans = new Map<number, ConfigPlan>();
  private readonly configFileName: string;
  private pluginMigrated = false;
  private pluginRetained = false;
  private readonly blockedConfigs = new Set<number>();
  // Binding statements rewritten in place (e.g. into the `html` import).
  private readonly repurposedStatements = new Set<number>();

  private readonly siblingBindings: ModuleBinding[] = [];
  private readonly siblingNameToModule = new Map<string, string>();

  constructor(root: SgRoot<Js>) {
    this.editor = new ConfigEditor(root.root());
    this.pluginBindings = collectModuleBindings(this.editor.rootNode, PLUGIN_MODULE);
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
    for (const moduleName of SIBLING_PLUGIN_MODULES) {
      const named = this.collectNamedBindings(moduleName);
      for (const binding of [...collectModuleBindings(this.editor.rootNode, moduleName), ...named]) {
        if (this.siblingNameToModule.has(binding.name)) continue;
        this.siblingBindings.push(binding);
        this.siblingNameToModule.set(binding.name, moduleName);
      }
    }
    this.configFileName = root.filename();
  }

  run(): string | null {
    // Taps on stages the native pipeline doesn't expose can't be carried over
    // — leave such files for manual migration.
    if (this.usesUnmappableHooks()) return null;
    const usePairs: SgNode<Js>[] = [];
    const loaderPairs: SgNode<Js>[] = [];
    const pluginsPairs: SgNode<Js>[] = [];
    for (const pair of this.editor.rootNode.findAll({ rule: { kind: "pair" } })) {
      const name = keyName(pair);
      if (name === "use") usePairs.push(pair);
      else if (name === "loader") loaderPairs.push(pair);
      else if (name === "plugins") pluginsPairs.push(pair);
    }
    // Dynamic favicon inputs need manual migration. Keep their HTML plugin
    // too, because the companion relies on its hooks.
    for (const pair of pluginsPairs) {
      const value = unwrapFilterCall(pair.field("value") ?? pair);
      if (!value.is("array")) continue;
      if (namedChildren(value).some((element) => {
        const sibling = this.siblingInstantiationOf(element);
        return sibling?.module === FAVICONS_MODULE && !this.faviconLogo(sibling.instantiation);
      })) {
        const config = pair.parent();
        if (config) this.blockedConfigs.add(config.range().start.index);
        this.pluginRetained = true;
      }
    }
    this.transformRules(usePairs, loaderPairs);
    for (const pair of pluginsPairs) this.transformPluginsPair(pair);
    this.migrateHooks();
    this.planConfigInsertions();
    this.editor.finalizeRemovals();
    if (!this.editor.hasEdits) return null;
    for (const binding of [...this.pluginBindings, ...this.siblingBindings]) {
      if (this.repurposedStatements.has(binding.statement.range().start.index)) continue;
      this.editor.removeBindingIfUnused(binding);
    }
    return this.editor.commit();
  }

  // `X.getHooks(...)` / `X.getCompilationHooks(...)` receivers on the plugin.
  private pluginHookReceivers(): SgNode<Js>[] {
    const receivers: SgNode<Js>[] = [];
    for (const node of this.editor.rootNode.findAll({ rule: { kind: "member_expression" } })) {
      const property = node.field("property")?.text();
      if (property !== "getHooks" && property !== "getCompilationHooks") continue;
      const objectPart = node.field("object");
      if (objectPart && this.pluginNames.has(objectPart.text())) receivers.push(node);
    }
    return receivers;
  }

  private usesUnmappableHooks(): boolean {
    if (!this.pluginNames.size || !this.pluginHookReceivers().length) return false;
    for (const node of this.pluginHookProperties()) {
      if (UNMAPPABLE_HOOKS.has(node.text())) return true;
    }
    return false;
  }

  // Only keys read from this plugin's hook object belong to its API. Other
  // plugins and ordinary application properties may use exactly the same names.
  private pluginHookProperties(): SgNode<Js>[] {
    const properties: SgNode<Js>[] = [];
    for (const receiver of this.pluginHookReceivers()) {
      const call = receiver.parent();
      const access = call?.parent();
      if (access?.is("member_expression")) {
        const property = access.field("property");
        if (property) properties.push(property);
      } else if (access?.is("variable_declarator")) {
        const name = access.field("name");
        if (name?.is("object_pattern")) {
          for (const member of namedChildren(name)) {
            const key = member.is("pair_pattern") ? member.field("key") : member;
            if (key) properties.push(key);
          }
        } else if (name?.is("identifier")) {
          for (const member of this.editor.rootNode.findAll({ rule: { kind: "member_expression" } })) {
            if (member.field("object")?.text() !== name.text()) continue;
            const property = member.field("property");
            if (property) properties.push(property);
          }
        }
      }
    }
    return properties;
  }

  private planFor(config: SgNode<Js>): ConfigPlan {
    const key = config.range().start.index;
    let plan = this.configPlans.get(key);
    if (!plan) {
      plan = {
        config,
        sourceDefaults: false,
        minification: [],
        commentLines: [],
        htmlEnabled: false,
        htmlProps: [],
        htmlFilename: null,
        outputProps: [],
        experimentsProps: [],
        pendingEntry: null,
        pluginMigratedHere: false,
      };
      this.configPlans.set(key, plan);
    }
    return plan;
  }

  private describeLost(name: string): string {
    const hint = LOST_OPTION_HINTS.get(name);
    return hint ? `${name} (${hint})` : name;
  }

  private requireExperimentsHtml(plan: ConfigPlan): void {
    if (!plan.experimentsProps.some((prop) => prop.name === "html")) {
      plan.experimentsProps.push({ name: "html", valueText: "true" });
    }
  }

  // `scriptLoading: "module"` means ESM output — a config-wide switch.
  private applyModuleScripts(plan: ConfigPlan, moduleScripts: boolean): void {
    if (!moduleScripts) return;
    if (!plan.outputProps.some((prop) => prop.name === "module")) {
      plan.outputProps.push({ name: "module", valueText: "true" });
    }
    // ESM output is stable since webpack 5.111. Remove the obsolete flag
    // only when its value is a literal, preserving any expression side effects.
    const experiments = findPair(plan.config, "experiments")?.field("value");
    const flag = experiments?.is("object") ? findPair(experiments, "outputModule") : undefined;
    const value = flag?.field("value");
    if (flag && (value?.is("true") || value?.is("false"))) {
      this.editor.keepBracesOpen(experiments!);
      this.editor.markForRemoval(flag);
    }
  }

  // ---------- module.rules (html-loader) ----------

  // A `use` entry replaceable by native HTML, unwrapping dev/prod guards.
  private isRemovableUseElement(node: SgNode<Js>): boolean {
    const branches = guardBranchesOf(node);
    if (branches) {
      return branches.length > 0 && branches.every((branch) => this.isRemovableUseElement(branch));
    }
    return loaderNameOf(node) === LOADER_NAME;
  }

  // Translate known equivalents; retain the config when an option would lose
  // executable behavior or change the module's export contract.
  private collectLoaderFindings(node: SgNode<Js>, findings: LoaderFindings): void {
    const branches = guardBranchesOf(node);
    if (branches) {
      for (const branch of branches) this.collectLoaderFindings(branch, findings);
      return;
    }
    if (!node.is("object") || loaderNameOf(node) !== LOADER_NAME) return;
    const optionsValue = findPair(node, "options")?.field("value");
    const minification = collectMinification(
      optionsValue?.is("object") ? findPair(optionsValue, "minimize")?.field("value") : undefined,
      `${LOADER_NAME}.minimize`,
    );
    findings.minification.push(minification);
    if (minification.lost.length) findings.supported = false;
    if (!optionsValue) return;
    if (!optionsValue.is("object")) {
      findings.supported = false;
      return;
    }
    if (namedChildren(optionsValue).some((child) => !child.is("pair") && !child.is("comment"))) {
      findings.supported = false;
      return;
    }
    for (const optionPair of pairsOf(optionsValue)) {
      const name = keyName(optionPair);
      const value = optionPair.field("value");
      if (name === "esModule") {
        // Native HTML exposes a default string export and its CJS shim also
        // returns that string directly, so both literal settings can migrate.
        if (!value?.is("true") && !value?.is("false")) findings.supported = false;
        continue;
      }
      if (name === "minimize") continue;
      if (name === "sources" && value) {
        const sources = nativeSources(value, /\.[cm]?tsx?$/.test(this.configFileName));
        if (sources === null) findings.supported = false;
        else {
          findings.parserProps.push({ name: "sources", valueText: sources.text });
          findings.sourceDefaults ||= sources.extendsDefaults;
        }
        continue;
      }
      if (name === "preprocessor" && value) {
        const template = nativeTemplate(value, /\.[cm]?tsx?$/.test(this.configFileName));
        if (template === null) findings.supported = false;
        else findings.parserProps.push({ name: "template", valueText: template });
        continue;
      }
      if (name === "postprocessor" && value && isIdentityCallback(value)) continue;
      findings.supported = false;
    }
  }

  // Webpack owns the rule when its array hangs on a `rules`/`oneOf` pair or
  // the config has a `module` ancestor — never fragments pushed into another
  // tool's config (Storybook, craco, …).
  private isWebpackRuleContext(pair: SgNode<Js>, arrayNode: SgNode<Js>): boolean {
    const owner = arrayNode.parent();
    if (owner && owner.is("pair")) {
      const name = keyName(owner);
      if (name === "rules" || name === "oneOf") return true;
    }
    return findConfigObjectFor(pair) !== null;
  }

  // Trivial html-loader rules are dropped (the `experiments.html: "auto"`
  // default takes over); surviving rules get `type: "html"` and turn the
  // default off, so `experiments.html: true` is added to their config.
  private transformRules(usePairs: SgNode<Js>[], loaderPairs: SgNode<Js>[]): void {
    const migrations: RuleMigration[] = [];
    for (const pair of usePairs) {
      const originalValue = pair.field("value");
      if (!originalValue) continue;
      const value = unwrapFilterCall(originalValue);
      const elements = value.is("array") ? namedChildren(value) : [value];
      if (!elements.length) continue;
      // Any other loader (template compilers, custom ones) stays in front.
      const kept = elements.filter((element) => !this.isRemovableUseElement(element));
      if (kept.length === elements.length) continue;
      const ruleObject = pair.parent();
      if (!ruleObject || !ruleObject.is("object")) continue;
      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) continue;
      const findings: LoaderFindings = { supported: true, sourceDefaults: false, parserProps: [], minification: [] };
      for (const element of elements) this.collectLoaderFindings(element, findings);
      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);
        return name === "test" || name === "use";
      });
      migrations.push({
        pair,
        ruleObject,
        kept,
        filterSuffix: filterSuffixOf(originalValue, value),
        findings,
        trivial,
        optionsPair: null,
      });
    }
    // Rule-level `loader:`/`options:` shorthand.
    for (const pair of loaderPairs) {
      const ruleObject = pair.parent();
      if (!ruleObject || !ruleObject.is("object")) continue;
      if (!findPair(ruleObject, "test") || findPair(ruleObject, "use")) continue;
      const value = pair.field("value");
      if (!value || !this.isRemovableUseElement(value)) continue;
      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) continue;
      const findings: LoaderFindings = { supported: true, sourceDefaults: false, parserProps: [], minification: [] };
      this.collectLoaderFindings(ruleObject, findings);
      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);
        return name === "test" || name === "loader" || name === "options";
      });
      migrations.push({
        pair,
        ruleObject,
        kept: [],
        filterSuffix: "",
        findings,
        trivial,
        optionsPair: findPair(ruleObject, "options") ?? null,
      });
    }
    // A retained html-loader emits JavaScript. Enabling native HTML or replacing
    // an HTML plugin's template beside it would parse that JavaScript as HTML.
    // Decide this before making edits to any of the owning config's rules.
    for (const migration of migrations) {
      if (this.canMigrateRule(migration)) continue;
      const config = findConfigObjectFor(migration.pair);
      if (config) {
        this.blockedConfigs.add(config.range().start.index);
        this.pluginRetained = true;
      }
    }
    for (const migration of migrations) this.applyRuleMigration(migration);
  }

  private canMigrateRule(swap: RuleMigration): boolean {
    if (!swap.findings.supported) return false;
    const config = findConfigObjectFor(swap.pair);
    const experiments = config && findPair(config, "experiments")?.field("value");
    const parser = findPair(swap.ruleObject, "parser")?.field("value");
    if (
      (experiments && !experiments.is("object")) ||
      (swap.findings.parserProps.length && parser && !parser.is("object"))
    ) return false;
    // Do not replace loader behavior with a conflicting existing parser option,
    // or flatten differently configured loader branches into one parser.
    for (const prop of swap.findings.parserProps) {
      const existing = parser?.is("object") ? findPair(parser, prop.name)?.field("value") : undefined;
      if (existing && existing.text() !== prop.valueText) return false;
      if (swap.findings.parserProps.some((other) => other.name === prop.name && other.valueText !== prop.valueText)) return false;
    }
    return !swap.findings.sourceDefaults || (!!config && this.canNormalizeSourceDefaults(config));
  }

  private applyRuleMigration(swap: RuleMigration): void {
    if (!this.canMigrateRule(swap)) return;
    const config = findConfigObjectFor(swap.pair);
    if (config && this.blockedConfigs.has(config.range().start.index)) return;
    const experiments = config && findPair(config, "experiments")?.field("value");
    const parser = findPair(swap.ruleObject, "parser")?.field("value");
    swap.findings.parserProps = dedupeProps(swap.findings.parserProps);
    if (swap.findings.sourceDefaults && config) this.planFor(config).sourceDefaults = true;
    if (config) {
      this.planFor(config).minification.push(
        ...(swap.findings.minification.length ? swap.findings.minification : [{ html: null, lost: [] }]),
      );
    }
    const survives =
      !swap.trivial ||
      !DEFAULT_HTML_TESTS.has(findPair(swap.ruleObject, "test")?.field("value")?.text() ?? "") ||
      swap.kept.length > 0 ||
      swap.findings.parserProps.length > 0;
    if (!survives) {
      // Explicitly disabled HTML must be enabled even when its loader rule goes.
      if (config && experiments && findPair(experiments, "html")) {
        this.requireExperimentsHtml(this.planFor(config));
      }
      this.editor.markForRemoval(cascadeRemovalTarget(swap.ruleObject));
      return;
    }
    const indent = lineIndent(this.editor.source, swap.pair.range().start.index);
    const multiline = swap.ruleObject.text().includes("\n");
    const separator = multiline ? `,\n${indent}` : ", ";
    let replacement = "";
    if (swap.kept.length) {
      // Guarded entries keep the original `.filter(...)` for their falsy branch.
      const keptTexts = swap.kept.map((loader) => loader.text());
      const keepsGuard = swap.kept.some((loader) => guardBranchesOf(loader) !== null);
      const filterSuffix = keepsGuard ? swap.filterSuffix || ".filter(Boolean)" : "";
      replacement += `use: [${keptTexts.join(", ")}]${filterSuffix}${separator}`;
    }
    const typePair = findPair(swap.ruleObject, "type");
    replacement += `type: "html"`;
    if (typePair) this.editor.markForRemoval(typePair);
    if (swap.findings.parserProps.length) {
      if (parser?.is("object")) {
        const missing = swap.findings.parserProps.filter((prop) => !findPair(parser, prop.name));
        if (missing.length) {
          this.editor.insertIntoObject(parser, () => missing.map((prop) => `${prop.name}: ${prop.valueText}`));
        }
      } else if (!parser) {
        const texts = swap.findings.parserProps.map((prop) => `${prop.name}: ${prop.valueText}`);
        replacement += `${separator}parser: { ${texts.join(", ")} }`;
      }
    }
    this.editor.replace(swap.pair, replacement);
    if (swap.optionsPair) this.editor.markForRemoval(swap.optionsPair);
    // A surviving rule that matches `.html` turns the "auto" default off.
    if (!ruleMatchesFiles(swap.ruleObject, HTML_SAMPLE_FILES)) return;
    if (config) this.requireExperimentsHtml(this.planFor(config));
  }

  // ---------- plugins ----------

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
    if (!element.is("new_expression")) return null;
    const constructorNode = element.field("constructor");
    if (!constructorNode) return null;
    if (this.pluginNames.has(constructorNode.text())) return element;
    // `new (require("html-webpack-plugin"))(...)` without a binding.
    const inner =
      constructorNode.is("parenthesized_expression")
        ? (namedChildren(constructorNode)[0] ?? constructorNode)
        : constructorNode;
    return isRequireOf(inner, PLUGIN_MODULE) ? element : null;
  }

  private transformPluginsPair(pluginsPair: SgNode<Js>): void {
    const configObject = pluginsPair.parent();
    if (!configObject || !configObject.is("object")) return;
    if (this.blockedConfigs.has(configObject.range().start.index)) return;
    const value = unwrapFilterCall(pluginsPair.field("value") ?? pluginsPair);
    if (!value.is("array")) return;
    const elements = namedChildren(value);
    const instances: { element: SgNode<Js>; instantiation: SgNode<Js> }[] = [];
    for (const element of elements) {
      const instantiation = this.pluginInstantiationOf(element);
      if (instantiation) instances.push({ element, instantiation });
    }
    if (!instances.length) return;
    // A computed destination cannot safely receive the native settings.
    if (["output", "experiments"].some((key) => {
      const destination = findPair(configObject, key)?.field("value");
      return destination && !destination.is("object");
    })) {
      this.pluginRetained = true;
      return;
    }
    // Every options argument must be an object literal to be understood.
    const optionObjects: (SgNode<Js> | undefined)[] = [];
    for (const { instantiation } of instances) {
      const argumentsNode = instantiation.field("arguments");
      const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
      if (optionsObject && (
        !optionsObject.is("object") ||
        namedChildren(optionsObject).some((child) => !child.is("pair") && !child.is("comment"))
      )) {
        this.pluginRetained = true;
        return;
      }
      const template = optionsObject && findPair(optionsObject, "template")?.field("value");
      const entry = findPair(configObject, "entry")?.field("value");
      if (template && (!template.is("string") || (entry && !this.replaceableEntryValue(entry)))) {
        this.pluginRetained = true;
        return;
      }
      optionObjects.push(optionsObject);
    }
    // Several instances (or a `chunks` list) mean per-entry pages instead of
    // the global `output.html`.
    const firstOptions = optionObjects[0];
    const chunkRestricted =
      instances.length > 1 ||
      (firstOptions !== undefined &&
        findPair(firstOptions, "chunks")?.field("value")?.is("array"));
    if (chunkRestricted) {
      this.migrateMultiPage(configObject, pluginsPair, elements, instances, optionObjects);
      return;
    }
    const findings = this.collectFindings(firstOptions);
    const plan = this.planFor(configObject);
    const mode: PageMode = findings.templateValue !== null ? "template" : "single";
    if (findings.templateValue !== null) this.migrateEntry(configObject, findings);
    else this.noteMultiPageEntry(configObject, findings);
    this.mergeIntoPlan(configObject, findings);
    const siblingRemoved = this.processSiblings(elements, [instances[0].element], mode, plan);
    this.removeInstances(pluginsPair, elements, [instances[0].element, ...siblingRemoved]);
    this.pluginMigrated = true;
  }

  private removeInstances(
    pluginsPair: SgNode<Js>,
    elements: SgNode<Js>[],
    removedElements: SgNode<Js>[],
  ): void {
    if (removedElements.length === elements.length) {
      this.editor.markForRemoval(pluginsPair);
    } else {
      for (const element of removedElements) this.editor.markForRemoval(element);
    }
  }

  // ---------- companion plugins ----------

  private faviconLogo(instantiation: SgNode<Js>): SgNode<Js> | null {
    const argsNode = instantiation.field("arguments");
    const args = argsNode ? namedChildren(argsNode).filter((node) => !node.is("comment")) : [];
    if (args.length !== 1) return null;
    const option = args[0];
    if (option.is("string")) return option;
    if (!option.is("object") || namedChildren(option).some((node) => !node.is("pair") && !node.is("comment"))) return null;
    const logo = findPair(option, "logo")?.field("value");
    return logo?.is("string") ? logo : null;
  }

  // Named bindings (`import { X }` / `const { X } = require(...)`) — e.g.
  // webpack-subresource-integrity's named export, which the default-import
  // resolution doesn't cover. Only single-name patterns, so removing the
  // statement can never drop another binding.
  private collectNamedBindings(moduleName: string): ModuleBinding[] {
    const bindings: ModuleBinding[] = [];
    for (const statement of this.editor.rootNode.findAll({ rule: { kind: "import_statement" } })) {
      const source = statement.field("source");
      if (!source || unquote(source.text()) !== moduleName) continue;
      const specifiers = statement.findAll({ rule: { kind: "import_specifier" } });
      if (specifiers.length !== 1) continue;
      const local = specifiers[0].field("alias") ?? specifiers[0].field("name");
      if (local) bindings.push({ name: local.text(), statement });
    }
    for (const kind of ["lexical_declaration", "variable_declaration"] as const) {
      for (const statement of this.editor.rootNode.findAll({ rule: { kind } })) {
        const declarators = namedChildren(statement).filter(
          (child) => child.is("variable_declarator"),
        );
        if (declarators.length !== 1) continue;
        const pattern = declarators[0].field("name");
        const valueNode = declarators[0].field("value");
        if (!pattern || !pattern.is("object_pattern")) continue;
        if (!valueNode || !isRequireOf(valueNode, moduleName)) continue;
        const properties = namedChildren(pattern);
        if (properties.length !== 1) continue;
        const property = properties[0];
        if (property.is("shorthand_property_identifier_pattern")) {
          bindings.push({ name: property.text(), statement });
        } else if (property.is("pair_pattern")) {
          const local = property.field("value");
          if (local) bindings.push({ name: local.text(), statement });
        }
      }
    }
    return bindings;
  }

  private siblingInstantiationOf(
    element: SgNode<Js>,
  ): { instantiation: SgNode<Js>; module: string } | null {
    const branches = guardBranchesOf(element);
    if (branches) {
      for (const branch of branches) {
        const found = this.siblingInstantiationOf(branch);
        if (found) return found;
      }
      return null;
    }
    if (!element.is("new_expression")) return null;
    const constructorNode = element.field("constructor");
    if (!constructorNode) return null;
    const inner = constructorNode.is("parenthesized_expression")
      ? namedChildren(constructorNode)[0] : constructorNode;
    const module = this.siblingNameToModule.get(constructorNode.text())
      ?? SIBLING_PLUGIN_MODULES.find((name) => inner && isRequireOf(inner, name));
    return module ? { instantiation: element, module } : null;
  }

  // Companion plugins piggybacked on html-webpack-plugin, so they only migrate
  // (or make sense at all) next to a migrated instance. Returns the elements
  // to remove alongside it.
  private processSiblings(
    elements: SgNode<Js>[],
    hwpElements: SgNode<Js>[],
    mode: PageMode,
    plan: ConfigPlan,
  ): SgNode<Js>[] {
    const hwpStarts = new Set(hwpElements.map((element) => element.range().start.index));
    const removed: SgNode<Js>[] = [];
    for (const element of elements) {
      if (hwpStarts.has(element.range().start.index)) continue;
      const sibling = this.siblingInstantiationOf(element);
      if (!sibling) continue;
      if (this.migrateSibling(sibling.module, sibling.instantiation, mode, plan)) {
        removed.push(element);
      } else {
        plan.commentLines.push(
          `Left ${sibling.module} in place — review it, its options could not be mapped to output.html`,
        );
      }
    }
    return removed;
  }

  private migrateSibling(
    module: string,
    instantiation: SgNode<Js>,
    mode: PageMode,
    plan: ConfigPlan,
  ): boolean {
    const argumentsNode = instantiation.field("arguments");
    const args = argumentsNode ? namedChildren(argumentsNode) : [];
    const lost: string[] = [];
    const props: HtmlProp[] = [];
    if (module === CSP_MODULE) {
      const policy = args[0];
      if (!policy) props.push({ name: "csp", valueText: "true" });
      else if (policy.is("object")) {
        props.push({ name: "csp", valueText: `{ policy: ${policy.text()} }` });
      } else return false;
      const options = args[1];
      if (options && options.is("object")) {
        for (const optionPair of pairsOf(options)) lost.push(keyName(optionPair) ?? "options");
      } else if (options) {
        lost.push("options");
      }
    } else if (module === SRI_MODULE) {
      let integrity = "true";
      let enabled = true;
      const options = args[0];
      if (options && !options.is("object")) return false;
      if (options) {
        for (const optionPair of pairsOf(options)) {
          const name = keyName(optionPair);
          const value = optionPair.field("value");
          if (name === "hashFuncNames" && value?.is("array")) integrity = value.text();
          else if (name === "enabled" && value?.is("false")) enabled = false;
          else if (name === "enabled") continue;
          else lost.push(name ?? "options");
        }
      }
      if (enabled) props.push({ name: "integrity", valueText: integrity });
    } else if (module === FAVICONS_MODULE) {
      const logo = this.faviconLogo(instantiation);
      if (!logo) return false;
      props.push({ name: "favicon", valueText: logo.text() });
      if (args[0]?.is("object")) {
        for (const pair of pairsOf(args[0])) {
          if (keyName(pair) !== "logo") lost.push(keyName(pair) ?? "options");
        }
      }
      plan.commentLines.push("Review: native favicon emits the source icon only; generate the required icon sizes/formats and web app manifest manually, then configure their links in output.html or the HTML template");
    } else return false;
    for (const prop of props) {
      if (mode === "multi") {
        // A global `output.html` would generate a page for every entry.
        lost.push(`${prop.name} (set output.html.${prop.name} by hand if every entry gets a page)`);
      } else if (mode === "template" && prop.name === "favicon") {
        // Favicons are only injected into webpack-generated pages.
        lost.push("favicon (add it to the template)");
      } else {
        plan.htmlProps.push(prop);
      }
    }
    if (lost.length) {
      plan.commentLines.push(
        `Removed ${module === FAVICONS_MODULE ? "favicon generator" : module} options without a native HTML equivalent: ${[...new Set(lost)].join(", ")}`,
      );
    }
    return true;
  }

  // One instance per page (`chunks: ["name"]`) maps to the entry descriptor
  // `html` option; entries no instance claims get no page, so the global
  // `output.html` stays off. Anything the shape can't express bails out.
  private migrateMultiPage(
    configObject: SgNode<Js>,
    pluginsPair: SgNode<Js>,
    elements: SgNode<Js>[],
    instances: { element: SgNode<Js>; instantiation: SgNode<Js> }[],
    optionObjects: (SgNode<Js> | undefined)[],
  ): void {
    const entryValue = findPair(configObject, "entry")?.field("value");
    if (!entryValue || !entryValue.is("object")) {
      this.pluginRetained = true;
      return;
    }
    const plan = this.planFor(configObject);
    const pages: { entryDescriptor: SgNode<Js>; htmlValue: string }[] = [];
    const minification: Minification[] = [];
    const lost: string[] = [];
    let moduleScripts = false;
    for (const options of optionObjects) {
      // Each page needs exactly one owning entry in `chunks`.
      const chunksValue = options ? findPair(options, "chunks")?.field("value") : undefined;
      const chunkNames = chunksValue?.is("array") ? namedChildren(chunksValue) : [];
      if (!options || chunkNames.length !== 1 || !chunkNames[0].is("string")) {
        this.pluginRetained = true;
        return;
      }
      const chunkName = unquote(chunkNames[0].text());
      const entryDescriptor = findPair(entryValue, chunkName)?.field("value");
      if (!entryDescriptor) {
        this.pluginRetained = true;
        return;
      }
      if (findPair(options, "template") || findPair(options, "templateContent")) {
        this.pluginRetained = true;
        return;
      }
      const findings = this.collectFindings(options, MULTI_PAGE_SKIPPED_OPTIONS);
      minification.push(findings.minification);
      // The page filename must fit the shared `htmlFilename: "[name].html"`.
      const filenameValue = findPair(options, "filename")?.field("value");
      if (filenameValue) {
        const filename = filenameValue.is("string") ? unquote(filenameValue.text()) : null;
        if (filename !== `${chunkName}.html` && filename !== "[name].html") {
          lost.push(`filename "${filename ?? "?"}" (output.htmlFilename is "[name].html")`);
        }
      }
      lost.push(...findings.lost);
      moduleScripts ||= findings.scriptLoadingModule;
      const htmlValue = findings.htmlProps.length
        ? `{ ${findings.htmlProps.map((prop) => `${prop.name}: ${prop.valueText}`).join(", ")} }`
        : "true";
      pages.push({ entryDescriptor, htmlValue });
    }
    // Per-page minification cannot be represented by a compilation-wide option.
    if (new Set(minification.map((request) => request.html ?? "{}")).size > 1) {
      this.pluginRetained = true;
      return;
    }
    plan.minification.push(...minification);
    const siblingRemoved = this.processSiblings(
      elements,
      instances.map((instance) => instance.element),
      "multi",
      plan,
    );
    this.removeInstances(pluginsPair, elements, [
      ...instances.map((instance) => instance.element),
      ...siblingRemoved,
    ]);
    for (const page of pages) {
      const node = page.entryDescriptor;
      if (node.is("object")) {
        if (!findPair(node, "html")) {
          this.editor.insertIntoObject(node, () => [`html: ${page.htmlValue}`]);
        }
      } else {
        this.editor.replace(node, `{ import: ${node.text()}, html: ${page.htmlValue} }`);
      }
    }
    plan.pluginMigratedHere = true;
    this.requireExperimentsHtml(plan);
    this.applyModuleScripts(plan, moduleScripts);
    plan.htmlFilename ??= '"[name].html"';
    if (lost.length) {
      plan.commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[...new Set(lost)].join(", ")}`,
      );
    }
    this.pluginMigrated = true;
  }

  // ---------- compilation hooks ----------

  // Retarget `HtmlWebpackPlugin.getHooks(...)` taps to the native
  // `HtmlModulesPlugin.getCompilationHooks(...)` stages. Only done when this
  // file's plugin setup was actually migrated and no instance survives.
  private migrateHooks(): void {
    if (!this.pluginMigrated || this.pluginRetained) return;
    const receivers = this.pluginHookReceivers();
    if (!receivers.length) return;
    const nativeReceiver = this.nativeHooksReceiver();
    for (const node of receivers) {
      this.editor.replace(node, `${nativeReceiver}.getCompilationHooks`);
    }
    // One review comment per statement holding a renamed tap.
    const commentedStatements = new Set<string>();
    for (const property of this.pluginHookProperties()) {
      const renamed = HOOK_RENAMES.get(property.text());
      if (!renamed) continue;
      this.editor.replace(property, property.is("shorthand_property_identifier_pattern")
        ? `${renamed}: ${property.text()}` : renamed);
      const statement = this.statementOf(property);
      const review = HOOK_REVIEW_COMMENTS.get(renamed);
      if (!statement || !review) continue;
      const key = `${statement.range().start.index}:${renamed}`;
      if (commentedStatements.has(key)) continue;
      commentedStatements.add(key);
      if (receivers.some((receiver) => receiver.range().start.index === statement.range().start.index)) {
        // An insertion at the same position as the receiver replacement would
        // be swallowed by commitEdits. A trailing comment avoids the overlap.
        this.editor.insertAfter(statement, ` /* Review: ${review} */`);
        continue;
      }
      const lineStart =
        this.editor.source.lastIndexOf("\n", statement.range().start.index - 1) + 1;
      const indent = lineIndent(this.editor.source, statement.range().start.index);
      this.editor.addEdit({
        startPos: lineStart,
        endPos: lineStart,
        insertedText: `${indent}// Review: ${review}\n`,
      });
    }
  }

  // The statement carrying a node, for placing a comment line above it.
  private statementOf(node: SgNode<Js>): SgNode<Js> | null {
    let current: SgNode<Js> | null = node;
    while (current) {
      const parent: SgNode<Js> | null = current.parent();
      if (!parent) return null;
      if (parent.is("statement_block") || parent.is("program") || parent.is("class_body")) {
        return current;
      }
      current = parent;
    }
    return null;
  }

  // Existing webpack binding, or an `html` import — rewriting the plugin's own
  // import statement in place when possible (a separate added import would
  // land inside the removed statement's range and be dropped).
  private nativeHooksReceiver(): string {
    const webpackBindings = collectModuleBindings(this.editor.rootNode, "webpack");
    if (webpackBindings.length) return `${webpackBindings[0].name}.html.HtmlModulesPlugin`;
    const binding = this.pluginBindings[0];
    if (binding) {
      const isEsm = binding.statement.is("import_statement");
      this.editor.replace(
        binding.statement,
        isEsm ? 'import { html } from "webpack";' : 'const { html } = require("webpack");',
      );
      this.repurposedStatements.add(binding.statement.range().start.index);
    } else {
      const edit = addImport(this.editor.rootNode as SgNode<Js, "program">, {
        type: "named",
        specifiers: [{ name: "html" }],
        from: "webpack",
        moduleType: "cjs",
      });
      if (edit) this.editor.addEdit(edit);
    }
    return "html.HtmlModulesPlugin";
  }

  // ---------- option mapping ----------

  private collectFindings(
    optionsObject: SgNode<Js> | undefined,
    skippedOptions?: Set<string>,
  ): InstanceFindings {
    const findings: InstanceFindings = {
      minification: collectMinification(
        optionsObject ? findPair(optionsObject, "minify")?.field("value") : undefined,
        "minify",
      ),
      htmlProps: [],
      htmlFilename: null,
      templateValue: null,
      lost: [],
      notes: [],
      pendingEntry: null,
      scriptLoadingModule: false,
    };
    if (!optionsObject) return findings;
    const templateValue = findPair(optionsObject, "template")?.field("value");
    const templateMode = Boolean(templateValue);
    if (templateValue) {
      if (templateValue.is("string")) findings.templateValue = templateValue.text();
      else findings.lost.push("template");
    }
    for (const optionPair of pairsOf(optionsObject)) {
      const name = keyName(optionPair);
      const optionValue = optionPair.field("value");
      if (!name || !optionValue) {
        findings.lost.push("options");
        continue;
      }
      if (name === "template" || DROPPABLE_OPTIONS.has(name)) continue;
      if (skippedOptions && skippedOptions.has(name)) continue;
      this.collectOption(name, optionValue, templateMode, findings);
    }
    return findings;
  }

  private collectOption(
    name: string,
    value: SgNode<Js>,
    templateMode: boolean,
    findings: InstanceFindings,
  ): void {
    const literal = value.is("string") ? unquote(value.text()) : null;
    // Head tags are only injected into webpack-generated pages, never into an
    // authored template — there the tag belongs in the template itself.
    if (HEAD_TAG_OPTIONS.has(name) && templateMode) {
      findings.lost.push(`${name} (add it to the template)`);
      return;
    }
    switch (name) {
      case "filename":
        if (value.is("string")) findings.htmlFilename = value.text();
        else findings.lost.push(this.describeLost(name));
        break;
      case "title":
      case "favicon":
      case "base":
        findings.htmlProps.push({ name, valueText: value.text() });
        break;
      case "meta":
        this.collectMetaOption(value, findings);
        break;
      case "inject":
        // `true` is the native default placement; the template authors its own tags.
        if (templateMode || value.is("true")) break;
        if (value.is("false") || literal === "body" || literal === "head") {
          findings.htmlProps.push({
            name,
            valueText: value.is("false") ? "false" : `"${literal}"`,
          });
        } else {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "scriptLoading":
        // Native `"auto"` already defers classic scripts.
        if (literal === "defer") break;
        if (templateMode) {
          if (literal === "module") {
            findings.lost.push(
              'scriptLoading (enable output.module and use <script type="module"> in the template)',
            );
          }
        } else if (literal === "blocking") {
          findings.htmlProps.push({ name, valueText: '"blocking"' });
        } else if (literal === "module") {
          findings.scriptLoadingModule = true;
        } else {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "minify":
        findings.lost.push(...findings.minification.lost);
        break;
      case "chunks":
        if (literal !== "all") findings.lost.push(this.describeLost(name));
        break;
      case "publicPath":
        if (literal !== "auto") findings.lost.push(this.describeLost(name));
        break;
      case "hash":
      case "xhtml":
        if (!value.is("false")) findings.lost.push(this.describeLost(name));
        break;
      default:
        findings.lost.push(this.describeLost(name));
    }
  }

  // Meta values map when they are `content` strings, or `{ name |
  // property, content }` objects (native keys `og:*` use `property` on their
  // own); anything else — extra attributes, `http-equiv` — is flagged per key.
  private collectMetaOption(value: SgNode<Js>, findings: InstanceFindings): void {
    if (!value.is("object")) {
      findings.lost.push("meta");
      return;
    }
    const parts: string[] = [];
    for (const metaPair of pairsOf(value)) {
      const metaKey = keyName(metaPair);
      const metaValue = metaPair.field("value");
      if (!metaKey || !metaValue) {
        findings.lost.push("meta");
        continue;
      }
      if (metaValue.is("string")) {
        parts.push(metaPair.text());
        continue;
      }
      if (metaValue.is("object")) {
        const nameValue = (findPair(metaValue, "name") ?? findPair(metaValue, "property"))?.field(
          "value",
        );
        const contentValue = findPair(metaValue, "content")?.field("value");
        const extraKeys = pairsOf(metaValue)
          .map((pair) => keyName(pair))
          .filter((key) => key !== "name" && key !== "property" && key !== "content");
        if (nameValue?.is("string") && contentValue && !extraKeys.length) {
          parts.push(`"${unquote(nameValue.text())}": ${contentValue.text()}`);
          continue;
        }
      }
      findings.lost.push(`meta.${metaKey}`);
    }
    if (parts.length) {
      findings.htmlProps.push({ name: "meta", valueText: `{ ${parts.join(", ")} }` });
    }
  }

  // ---------- entry handling ----------

  // With `output.html` each entry gets its own page, unlike the plugin's
  // single page referencing every chunk — worth a note on multi-entry configs.
  private noteMultiPageEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const entryValue = findPair(configObject, "entry")?.field("value");
    if (entryValue && entryValue.is("object") && pairsOf(entryValue).length > 1) {
      findings.notes.push(
        "output.html emits one page per entry; html-webpack-plugin emitted a single page with every chunk",
      );
    }
  }

  // The template becomes the entry (native HTML entry point); the previous
  // entry must be referenced from the template with a `<script>` tag. The HTML
  // workflow step applies that edit through the runner using shared state.
  private migrateEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const templateValue = findings.templateValue as string;
    const entryPair = findPair(configObject, "entry");
    if (!entryPair) {
      const injected = queueTemplate(this.configFileName, unquote(templateValue), "./src/index.js", "main");
      findings.pendingEntry = {
        text: templateValue,
        comment: injected
          ? `The template is now the entry: it must load the previous default entry via ${templateScriptTag({ src: injected, chunkName: "main" })} (added by the HTML workflow step when the template is included)`
          : `The template is now the entry: reference the previous entry (webpack's default is ./src/index.js) from it, e.g. <script defer src="./src/index.js"></script>`,
      };
      return;
    }
    const entryValue = entryPair.field("value");
    const replaceable = entryValue ? this.replaceableEntryValue(entryValue) : null;
    if (!replaceable) {
      findings.lost.push("template (make the template an .html entry that loads your JS)");
      return;
    }
    const chunkName = entryValue?.is("object") ? keyName(pairsOf(entryValue)[0]) ?? "main" : "main";
    const injected = queueTemplate(this.configFileName, unquote(templateValue), unquote(replaceable.text()), chunkName);
    const comment = injected
      ? `The template is now the entry: it must load the previous entry via ${templateScriptTag({ src: injected, chunkName })} (added by the HTML workflow step when the template is included)`
      : `The template is now the entry: reference the previous entry from it, e.g. <script defer src=${replaceable.text()}></script>`;
    const multiline = configObject.text().includes("\n");
    if (multiline) {
      const indent = lineIndent(this.editor.source, entryPair.range().start.index);
      this.editor.addEdit({
        startPos: entryPair.range().start.index,
        endPos: entryPair.range().start.index,
        insertedText: `// ${comment}\n${indent}`,
      });
      this.editor.replace(replaceable, findings.templateValue as string);
    } else {
      this.editor.replace(replaceable, `/* ${comment.replace(/\*\//g, "* /")} */ ${findings.templateValue}`);
    }
  }

  // A string entry value the template path can take over: the value itself, a
  // single-element array, or a single-key object's string value.
  private replaceableEntryValue(entryValue: SgNode<Js>): SgNode<Js> | null {
    if (entryValue.is("string")) return entryValue;
    if (entryValue.is("array")) {
      const elements = namedChildren(entryValue);
      return elements.length === 1 && elements[0].is("string") ? elements[0] : null;
    }
    if (entryValue.is("object")) {
      const entryPairs = pairsOf(entryValue);
      if (entryPairs.length !== 1) return null;
      if (namedChildren(entryValue).some((child) => !child.is("pair") && !child.is("comment"))) return null;
      const key = entryPairs[0].field("key");
      if (!key || key.is("computed_property_name") || key.text().includes("\\")) return null;
      const inner = entryPairs[0].field("value");
      return inner && inner.is("string") ? inner : null;
    }
    return null;
  }

  // ---------- config-level insertions ----------

  private canNormalizeSourceDefaults(config: SgNode<Js>): boolean {
    let current: SgNode<Js> = config;
    for (const name of ["module", "parser", "html"]) {
      const value = findPair(current, name)?.field("value");
      if (!value) return true;
      if (!value.is("object") || namedChildren(value).some((child) => !child.is("pair") && !child.is("comment"))) return false;
      current = value;
    }
    const sources = findPair(current, "sources")?.field("value");
    if (!sources || sources.is("true")) return true;
    const elements = sources.is("array") ? namedChildren(sources).filter((node) => !node.is("comment")) : [];
    return elements.length === 1 && elements[0].is("string") && unquote(elements[0].text()) === "...";
  }

  private normalizeSourceDefaults(config: SgNode<Js>): void {
    // Rule parser options are clever-merged with global HTML parser defaults.
    // Its default `sources: true` would expand a rule's "..." to `[true, ...]`,
    // which fails validation. `["..."]` is equivalent but survives that merge.
    let current = findPair(config, "module")!.field("value")!;
    for (const [name, text] of [
      ["parser", 'parser: { html: { sources: ["..."] } }'],
      ["html", 'html: { sources: ["..."] }'],
    ]) {
      const value = findPair(current, name)?.field("value");
      if (!value) {
        this.editor.insertIntoObject(current, () => [text]);
        return;
      }
      current = value;
    }
    const sources = findPair(current, "sources")?.field("value");
    if (sources?.is("true")) this.editor.replace(sources, '["..."]');
    else if (!sources) this.editor.insertIntoObject(current, () => ['sources: ["..."]']);
  }

  private mergeIntoPlan(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const plan = this.planFor(configObject);
    plan.minification.push(findings.minification);
    plan.pluginMigratedHere = true;
    this.requireExperimentsHtml(plan);
    if (findings.lost.length) {
      plan.commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[...new Set(findings.lost)].join(", ")}`,
      );
    }
    plan.commentLines.push(...findings.notes);
    if (findings.templateValue === null) plan.htmlEnabled = true;
    plan.htmlProps.push(...findings.htmlProps);
    this.applyModuleScripts(plan, findings.scriptLoadingModule);
    // The plugin emitted `index.html` by default; native defaults to `[name].html`.
    plan.htmlFilename ??= findings.htmlFilename ?? '"index.html"';
    plan.pendingEntry = findings.pendingEntry;
  }

  private planConfigInsertions(): void {
    for (const plan of this.configPlans.values()) {
      if (plan.sourceDefaults) this.normalizeSourceDefaults(plan.config);
      const topProperties: ((indent: string, unit: string) => string)[] = [];
      const optimization = planMinification(this.editor, plan.config, plan.minification, plan.commentLines);
      if (optimization) topProperties.push(() => optimization);
      const pendingEntry = plan.pendingEntry;
      if (pendingEntry) {
        topProperties.push(
          (indent) => `// ${pendingEntry.comment}\n${indent}entry: ${pendingEntry.text}`,
        );
      }
      const outputProps: HtmlProp[] = [];
      const htmlProps = dedupeProps(plan.htmlProps);
      const existingOutput = findPair(plan.config, "output")?.field("value");
      const existingHtml = existingOutput?.is("object")
        ? findPair(existingOutput, "html")?.field("value") : undefined;
      if (existingHtml?.is("object")) {
        const missing = htmlProps.filter((prop) => !findPair(existingHtml, prop.name));
        if (missing.length) {
          this.editor.insertIntoObject(existingHtml, () => missing.map((prop) => `${prop.name}: ${prop.valueText}`));
        }
      }
      if (plan.htmlEnabled || htmlProps.length) {
        outputProps.push({
          name: "html",
          valueText: htmlProps.length
            ? `{ ${htmlProps.map((prop) => `${prop.name}: ${prop.valueText}`).join(", ")} }`
            : "true",
        });
      }
      if (plan.htmlFilename !== null) {
        outputProps.push({ name: "htmlFilename", valueText: plan.htmlFilename });
      }
      outputProps.push(...plan.outputProps);
      if (outputProps.length) {
        this.planObjectProps(plan.config, "output", outputProps, plan.commentLines, topProperties);
      }
      if (plan.experimentsProps.length) {
        this.planObjectProps(
          plan.config,
          "experiments",
          plan.experimentsProps,
          outputProps.length ? [] : plan.commentLines,
          topProperties,
        );
      }
      if (!outputProps.length && !plan.experimentsProps.length && plan.commentLines.length) {
        this.insertReviewComments(plan.config, plan.commentLines);
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

  private insertReviewComments(node: SgNode<Js>, lines: string[]): void {
    if (!lines.length) return;
    const position = node.range().start.index;
    this.editor.addEdit({
      startPos: position,
      endPos: position,
      insertedText: `/* ${lines.join("; ").replace(/\*\//g, "* /")} */ `,
    });
  }

  // Insert props into the config's `key` object, creating it when absent; an
  // existing non-object value (e.g. a variable) is left alone. Comment lines
  // ride on the first inserted property.
  private planObjectProps(
    config: SgNode<Js>,
    key: string,
    props: HtmlProp[],
    commentLines: string[],
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    const withComments = (propertyText: string, indent: string, first: boolean): string => {
      if (!first || !commentLines.length) return propertyText;
      if (!config.text().includes("\n")) {
        return `/* ${commentLines.join("; ").replace(/\*\//g, "* /")} */ ${propertyText}`;
      }
      return `${commentLines.map((line) => `// ${line}\n${indent}`).join("")}${propertyText}`;
    };
    const value = findPair(config, key)?.field("value");
    if (value && value.is("object")) {
      for (const prop of props) {
        const existing = findPair(value, prop.name)?.field("value");
        if (!existing) continue;
        if (
          (key === "experiments" && prop.name === "html") ||
          (key === "output" && prop.name === "module") ||
          (key === "output" && prop.name === "html" && (existing.is("false") || existing.is("true")))
        ) {
          this.editor.replace(existing, prop.valueText);
        }
      }
      const missing = props.filter((prop) => !findPair(value, prop.name));
      if (!missing.length) {
        this.insertReviewComments(value, commentLines);
        return;
      }
      this.editor.insertIntoObject(value, (indent) =>
        missing.map((prop, index) =>
          withComments(`${prop.name}: ${prop.valueText}`, indent, index === 0),
        ),
      );
    } else if (!value) {
      topProperties.push((indent, unit) => {
        const inner = indent + unit;
        const texts = props.map((prop, index) =>
          withComments(`${prop.name}: ${prop.valueText}`, inner, index === 0),
        );
        return `${key}: {\n${texts.map((text) => `${inner}${text}`).join(",\n")},\n${indent}}`;
      });
    }
  }
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  const result = new HtmlMigration(root).run();
  recordSource(root.filename(), result ?? root.root().text());
  return result;
}

export default transform;

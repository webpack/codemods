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

const PLUGIN_MODULE = "html-webpack-plugin";
const LOADER_NAME = "html-loader";
const HTML_SAMPLE_FILES = ["/file.html"];
// Native HTML defaults already covered by these plugin option values.
const HEAD_TAG_OPTIONS = new Set(["title", "meta", "favicon", "base"]);
// Build-ergonomics options with no effect on the emitted page.
const DROPPABLE_OPTIONS = new Set(["cache", "showErrors", "chunksSortMode"]);
// Loader options native HTML covers on its own: `esModule` (native exports are
// ESM) and boolean `minimize` (optimization.minimizer minifies in production).
const DROPPABLE_LOADER_OPTIONS = new Set(["esModule"]);
// Manual migration paths appended to the review comment where one exists.
const LOST_OPTION_HINTS = new Map([
  ["publicPath", "set output.publicPath"],
  ["hash", "use [contenthash] in output.htmlFilename"],
  ["chunks", "use per-entry `html` descriptors"],
  ["excludeChunks", "use per-entry `html` descriptors"],
  ["scriptLoading", "module scripts come from experiments.outputModule"],
  ["minify", "production HTML is minified by default; customize via optimization.minimizer (minimizer-webpack-plugin)"],
  ["templateContent", "author the page as an .html entry file"],
  ["html-loader.sources", "customize the rule's parser.sources list"],
  [
    "html-loader.preprocessor",
    "move it to the rule's parser.template — synchronous (source, { module, resource }) => string",
  ],
  [
    "html-loader.postprocessor",
    "tap HtmlModulesPlugin.getCompilationHooks(compilation).transformHtml for emitted pages",
  ],
  ["html-loader.minimize", "customize via optimization.minimizer (minimizer-webpack-plugin)"],
]);

type FsModule = typeof import("node:fs");
type PathModule = typeof import("node:path");

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
  if (node.kind() !== "call_expression") return false;
  const callee = node.field("function");
  if (!callee || callee.kind() !== "identifier" || callee.text() !== "require") return false;
  const argumentsNode = node.field("arguments");
  const args = argumentsNode ? namedChildren(argumentsNode) : [];
  return args.length === 1 && args[0].kind() === "string" && unquote(args[0].text()) === moduleName;
}

// Everything one plugin instance contributes to its enclosing config.
interface InstanceFindings {
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

// Loader options translated into the surviving rule, plus the ones lost.
interface LoaderFindings {
  lost: string[];
  parserProps: HtmlProp[];
}

// Properties to add to one webpack config object once all removals are known.
interface ConfigPlan {
  config: SgNode<Js>;
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

// Insert the script tag before `</head>` (or `</body>`), matching the
// closing tag's indentation; append when the template has neither.
function insertScriptTag(html: string, tag: string): string {
  for (const marker of [/<\/head>/i, /<\/body>/i]) {
    const match = marker.exec(html);
    if (!match) continue;
    const lineStart = html.lastIndexOf("\n", match.index) + 1;
    const closingIndent = html.slice(lineStart, match.index);
    if (!/^[ \t]*$/.test(closingIndent)) {
      // Closing tag mid-line — insert inline right before it.
      return `${html.slice(0, match.index)}${tag}${html.slice(match.index)}`;
    }
    // Indent like the previous sibling line when it sits deeper.
    const before = html.slice(0, lineStart);
    const prevLineStart = before.lastIndexOf("\n", before.length - 2) + 1;
    const prevIndentMatch = /^[ \t]*/.exec(before.slice(prevLineStart));
    const prevIndent = prevIndentMatch ? prevIndentMatch[0] : "";
    const indent = prevIndent.length > closingIndent.length ? prevIndent : `${closingIndent}  `;
    return `${before}${indent}${tag}\n${html.slice(lineStart)}`;
  }
  return `${html.replace(/\s*$/, "")}\n${tag}\n`;
}

class HtmlMigration {
  private readonly editor: ConfigEditor;
  private readonly pluginBindings;
  private readonly pluginNames: Set<string>;
  private readonly configPlans = new Map<number, ConfigPlan>();
  private readonly configFileName: string;
  private readonly fileSystem: FsModule | null;
  private readonly pathModule: PathModule | null;
  private injectDebug = "";
  private pluginMigrated = false;
  private pluginRetained = false;
  // Binding statements rewritten in place (e.g. into the `html` import).
  private readonly repurposedStatements = new Set<number>();

  private readonly siblingBindings: ModuleBinding[] = [];
  private readonly siblingNameToModule = new Map<string, string>();

  constructor(root: SgRoot<Js>, fileSystem: FsModule | null, pathModule: PathModule | null) {
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
    this.fileSystem = fileSystem;
    this.pathModule = pathModule;
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
    for (const node of this.editor.rootNode.findAll({ rule: { kind: "property_identifier" } })) {
      if (UNMAPPABLE_HOOKS.has(node.text())) return true;
    }
    return false;
  }

  private planFor(config: SgNode<Js>): ConfigPlan {
    const key = config.range().start.index;
    let plan = this.configPlans.get(key);
    if (!plan) {
      plan = {
        config,
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
    if (!plan.experimentsProps.some((prop) => prop.name === "outputModule")) {
      plan.experimentsProps.push({ name: "outputModule", valueText: "true" });
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

  // Translate each html-loader option into the surviving rule's `parser` when
  // native HTML has an equivalent; everything else lands in `lost`.
  private collectLoaderFindings(node: SgNode<Js>, findings: LoaderFindings): void {
    const branches = guardBranchesOf(node);
    if (branches) {
      for (const branch of branches) this.collectLoaderFindings(branch, findings);
      return;
    }
    if (node.kind() !== "object" || loaderNameOf(node) !== LOADER_NAME) return;
    const optionsValue = findPair(node, "options")?.field("value");
    if (!optionsValue) return;
    if (optionsValue.kind() !== "object") {
      findings.lost.push(`${LOADER_NAME}.options`);
      return;
    }
    for (const optionPair of pairsOf(optionsValue)) {
      const name = keyName(optionPair);
      const value = optionPair.field("value");
      if (name !== null && DROPPABLE_LOADER_OPTIONS.has(name)) continue;
      if (name === "minimize" && value) {
        // Custom minifier settings don't carry over; booleans do (production
        // minification via optimization.minimizer is the native behavior).
        if (value.kind() !== "true" && value.kind() !== "false") {
          findings.lost.push(this.describeLost(`${LOADER_NAME}.minimize`));
        }
        continue;
      }
      if (name === "sources" && value) {
        // Booleans map to the rule's parser; source lists need a human.
        if (value.kind() === "true" || value.kind() === "false") {
          findings.parserProps.push({ name: "sources", valueText: value.text() });
        } else {
          findings.lost.push(this.describeLost(`${LOADER_NAME}.sources`));
        }
        continue;
      }
      findings.lost.push(this.describeLost(`${LOADER_NAME}.${name ?? "options"}`));
    }
  }

  // Webpack owns the rule when its array hangs on a `rules`/`oneOf` pair or
  // the config has a `module` ancestor — never fragments pushed into another
  // tool's config (Storybook, craco, …).
  private isWebpackRuleContext(pair: SgNode<Js>, arrayNode: SgNode<Js>): boolean {
    const owner = arrayNode.parent();
    if (owner && owner.kind() === "pair") {
      const name = keyName(owner);
      if (name === "rules" || name === "oneOf") return true;
    }
    return findConfigObjectFor(pair) !== null;
  }

  // Trivial html-loader rules are dropped (the `experiments.html: "auto"`
  // default takes over); surviving rules get `type: "html"` and turn the
  // default off, so `experiments.html: true` is added to their config.
  private transformRules(usePairs: SgNode<Js>[], loaderPairs: SgNode<Js>[]): void {
    for (const pair of usePairs) {
      const originalValue = pair.field("value");
      if (!originalValue) continue;
      const value = unwrapFilterCall(originalValue);
      const elements = value.kind() === "array" ? namedChildren(value) : [value];
      if (!elements.length) continue;
      // Any other loader (template compilers, custom ones) stays in front.
      const kept = elements.filter((element) => !this.isRemovableUseElement(element));
      if (kept.length === elements.length) continue;
      const ruleObject = pair.parent();
      if (!ruleObject || ruleObject.kind() !== "object") continue;
      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) continue;
      const findings: LoaderFindings = { lost: [], parserProps: [] };
      for (const element of elements) this.collectLoaderFindings(element, findings);
      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);
        return name === "test" || name === "use";
      });
      this.applyRuleMigration({
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
      if (!ruleObject || ruleObject.kind() !== "object") continue;
      if (!findPair(ruleObject, "test") || findPair(ruleObject, "use")) continue;
      const value = pair.field("value");
      if (!value || !this.isRemovableUseElement(value)) continue;
      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) continue;
      const findings: LoaderFindings = { lost: [], parserProps: [] };
      this.collectLoaderFindings(ruleObject, findings);
      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);
        return name === "test" || name === "loader" || name === "options";
      });
      this.applyRuleMigration({
        pair,
        ruleObject,
        kept: [],
        filterSuffix: "",
        findings,
        trivial,
        optionsPair: findPair(ruleObject, "options") ?? null,
      });
    }
  }

  private applyRuleMigration(swap: {
    pair: SgNode<Js>;
    ruleObject: SgNode<Js>;
    kept: SgNode<Js>[];
    filterSuffix: string;
    findings: LoaderFindings;
    trivial: boolean;
    optionsPair: SgNode<Js> | null;
  }): void {
    const survives =
      !swap.trivial ||
      swap.kept.length > 0 ||
      swap.findings.lost.length > 0 ||
      swap.findings.parserProps.length > 0;
    if (!survives) {
      this.editor.markForRemoval(cascadeRemovalTarget(swap.ruleObject));
      return;
    }
    const indent = lineIndent(this.editor.source, swap.pair.range().start.index);
    const multiline = swap.ruleObject.text().includes("\n");
    // Flag dropped loader options right where they lived.
    let commentPrefix = "";
    if (swap.findings.lost.length) {
      const message = `Removed loader options without a native HTML equivalent: ${[...new Set(swap.findings.lost)].join(", ")}`;
      commentPrefix = multiline ? `// ${message}\n${indent}` : `/* ${message} */ `;
    }
    const separator = multiline ? `,\n${indent}` : ", ";
    let replacement = `${commentPrefix}`;
    if (swap.kept.length) {
      // Guarded entries keep the original `.filter(...)` for their falsy branch.
      const keptTexts = swap.kept.map((loader) => loader.text());
      const keepsGuard = swap.kept.some((loader) => guardBranchesOf(loader) !== null);
      const filterSuffix = keepsGuard ? swap.filterSuffix || ".filter(Boolean)" : "";
      replacement += `use: [${keptTexts.join(", ")}]${filterSuffix}${separator}`;
    }
    replacement += `type: "html"`;
    if (swap.findings.parserProps.length) {
      const texts = swap.findings.parserProps.map((prop) => `${prop.name}: ${prop.valueText}`);
      replacement += `${separator}parser: { ${texts.join(", ")} }`;
    }
    this.editor.replace(swap.pair, replacement);
    if (swap.optionsPair) this.editor.markForRemoval(swap.optionsPair);
    // A surviving rule that matches `.html` turns the "auto" default off.
    if (!ruleMatchesFiles(swap.ruleObject, HTML_SAMPLE_FILES)) return;
    const config = findConfigObjectFor(swap.pair);
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
    if (element.kind() !== "new_expression") return null;
    const constructorNode = element.field("constructor");
    if (!constructorNode) return null;
    if (this.pluginNames.has(constructorNode.text())) return element;
    // `new (require("html-webpack-plugin"))(...)` without a binding.
    const inner =
      constructorNode.kind() === "parenthesized_expression"
        ? (namedChildren(constructorNode)[0] ?? constructorNode)
        : constructorNode;
    return isRequireOf(inner, PLUGIN_MODULE) ? element : null;
  }

  private transformPluginsPair(pluginsPair: SgNode<Js>): void {
    const configObject = pluginsPair.parent();
    if (!configObject || configObject.kind() !== "object") return;
    const value = unwrapFilterCall(pluginsPair.field("value") ?? pluginsPair);
    if (value.kind() !== "array") return;
    const elements = namedChildren(value);
    const instances: { element: SgNode<Js>; instantiation: SgNode<Js> }[] = [];
    for (const element of elements) {
      const instantiation = this.pluginInstantiationOf(element);
      if (instantiation) instances.push({ element, instantiation });
    }
    if (!instances.length) return;
    // Every options argument must be an object literal to be understood.
    const optionObjects: (SgNode<Js> | undefined)[] = [];
    for (const { instantiation } of instances) {
      const argumentsNode = instantiation.field("arguments");
      const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
      if (optionsObject && optionsObject.kind() !== "object") {
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
        findPair(firstOptions, "chunks")?.field("value")?.kind() === "array");
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
          (child) => child.kind() === "variable_declarator",
        );
        if (declarators.length !== 1) continue;
        const pattern = declarators[0].field("name");
        const valueNode = declarators[0].field("value");
        if (!pattern || pattern.kind() !== "object_pattern") continue;
        if (!valueNode || !isRequireOf(valueNode, moduleName)) continue;
        const properties = namedChildren(pattern);
        if (properties.length !== 1) continue;
        const property = properties[0];
        if (property.kind() === "shorthand_property_identifier_pattern") {
          bindings.push({ name: property.text(), statement });
        } else if (property.kind() === "pair_pattern") {
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
    if (element.kind() !== "new_expression") return null;
    const constructorNode = element.field("constructor");
    const module = constructorNode
      ? this.siblingNameToModule.get(constructorNode.text())
      : undefined;
    return constructorNode && module ? { instantiation: element, module } : null;
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
      else if (policy.kind() === "object") {
        props.push({ name: "csp", valueText: `{ policy: ${policy.text()} }` });
      } else return false;
      const options = args[1];
      if (options && options.kind() === "object") {
        for (const optionPair of pairsOf(options)) lost.push(keyName(optionPair) ?? "options");
      } else if (options) {
        lost.push("options");
      }
    } else if (module === SRI_MODULE) {
      let integrity = "true";
      let enabled = true;
      const options = args[0];
      if (options && options.kind() !== "object") return false;
      if (options) {
        for (const optionPair of pairsOf(options)) {
          const name = keyName(optionPair);
          const value = optionPair.field("value");
          if (name === "hashFuncNames" && value?.kind() === "array") integrity = value.text();
          else if (name === "enabled" && value?.kind() === "false") enabled = false;
          else if (name === "enabled") continue;
          else lost.push(name ?? "options");
        }
      }
      if (enabled) props.push({ name: "integrity", valueText: integrity });
    } else {
      // favicons-webpack-plugin — only the logo path maps (native `favicon`).
      const argument = args[0];
      if (argument && argument.kind() === "string") {
        props.push({ name: "favicon", valueText: argument.text() });
      } else if (argument && argument.kind() === "object") {
        const logo = findPair(argument, "logo")?.field("value");
        if (!logo || logo.kind() !== "string") return false;
        props.push({ name: "favicon", valueText: logo.text() });
        for (const optionPair of pairsOf(argument)) {
          const name = keyName(optionPair);
          if (name !== "logo") lost.push(name ?? "options");
        }
      } else return false;
    }
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
        `Removed ${module} options without a native HTML equivalent: ${[...new Set(lost)].join(", ")}`,
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
    if (!entryValue || entryValue.kind() !== "object") {
      this.pluginRetained = true;
      return;
    }
    const plan = this.planFor(configObject);
    const pages: { entryDescriptor: SgNode<Js>; htmlValue: string }[] = [];
    const lost: string[] = [];
    let moduleScripts = false;
    for (const options of optionObjects) {
      // Each page needs exactly one owning entry in `chunks`.
      const chunksValue = options ? findPair(options, "chunks")?.field("value") : undefined;
      const chunkNames = chunksValue?.kind() === "array" ? namedChildren(chunksValue) : [];
      if (!options || chunkNames.length !== 1 || chunkNames[0].kind() !== "string") {
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
      // The page filename must fit the shared `htmlFilename: "[name].html"`.
      const filenameValue = findPair(options, "filename")?.field("value");
      if (filenameValue) {
        const filename = filenameValue.kind() === "string" ? unquote(filenameValue.text()) : null;
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
      if (node.kind() === "object") {
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
    const rootNode = this.editor.rootNode;
    // One review comment per statement holding a renamed tap.
    const commentedStatements = new Set<string>();
    for (const property of rootNode.findAll({ rule: { kind: "property_identifier" } })) {
      const renamed = HOOK_RENAMES.get(property.text());
      if (!renamed) continue;
      this.editor.replace(property, renamed);
      const statement = this.statementOf(property);
      const review = HOOK_REVIEW_COMMENTS.get(renamed);
      if (!statement || !review) continue;
      const key = `${statement.range().start.index}:${renamed}`;
      if (commentedStatements.has(key)) continue;
      commentedStatements.add(key);
      const lineStart =
        this.editor.source.lastIndexOf("\n", statement.range().start.index - 1) + 1;
      const indent = lineIndent(this.editor.source, statement.range().start.index);
      this.editor.addEdit({
        startPos: lineStart,
        endPos: lineStart,
        insertedText: `${indent}// Review: ${review}\n`,
      });
    }
    for (const shorthand of rootNode.findAll({
      rule: { kind: "shorthand_property_identifier_pattern" },
    })) {
      const renamed = HOOK_RENAMES.get(shorthand.text());
      // Keep the local variable name; only the destructured key changes.
      if (renamed) this.editor.replace(shorthand, `${renamed}: ${shorthand.text()}`);
    }
  }

  // The statement carrying a node, for placing a comment line above it.
  private statementOf(node: SgNode<Js>): SgNode<Js> | null {
    let current: SgNode<Js> | null = node;
    while (current) {
      const parent: SgNode<Js> | null = current.parent();
      if (!parent) return null;
      const kind = parent.kind();
      if (kind === "statement_block" || kind === "program" || kind === "class_body") {
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
      const isEsm = binding.statement.kind() === "import_statement";
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
      if (templateValue.kind() === "string") findings.templateValue = templateValue.text();
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
    const literal = value.kind() === "string" ? unquote(value.text()) : null;
    // Head tags are only injected into webpack-generated pages, never into an
    // authored template — there the tag belongs in the template itself.
    if (HEAD_TAG_OPTIONS.has(name) && templateMode) {
      findings.lost.push(`${name} (add it to the template)`);
      return;
    }
    switch (name) {
      case "filename":
        if (value.kind() === "string") findings.htmlFilename = value.text();
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
        if (templateMode || value.kind() === "true") break;
        if (value.kind() === "false" || literal === "body" || literal === "head") {
          findings.htmlProps.push({
            name,
            valueText: value.kind() === "false" ? "false" : `"${literal}"`,
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
              'scriptLoading (enable experiments.outputModule and use <script type="module"> in the template)',
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
        if (value.kind() !== "true" && literal !== "auto") {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "chunks":
        if (literal !== "all") findings.lost.push(this.describeLost(name));
        break;
      case "publicPath":
        if (literal !== "auto") findings.lost.push(this.describeLost(name));
        break;
      case "hash":
      case "xhtml":
        if (value.kind() !== "false") findings.lost.push(this.describeLost(name));
        break;
      default:
        findings.lost.push(this.describeLost(name));
    }
  }

  // Meta values map when they are `content` strings, or `{ name |
  // property, content }` objects (native keys `og:*` use `property` on their
  // own); anything else — extra attributes, `http-equiv` — is flagged per key.
  private collectMetaOption(value: SgNode<Js>, findings: InstanceFindings): void {
    if (value.kind() !== "object") {
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
      if (metaValue.kind() === "string") {
        parts.push(metaPair.text());
        continue;
      }
      if (metaValue.kind() === "object") {
        const nameValue = (findPair(metaValue, "name") ?? findPair(metaValue, "property"))?.field(
          "value",
        );
        const contentValue = findPair(metaValue, "content")?.field("value");
        const extraKeys = pairsOf(metaValue)
          .map((pair) => keyName(pair))
          .filter((key) => key !== "name" && key !== "property" && key !== "content");
        if (nameValue?.kind() === "string" && contentValue && !extraKeys.length) {
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
    if (entryValue && entryValue.kind() === "object" && pairsOf(entryValue).length > 1) {
      findings.notes.push(
        "output.html emits one page per entry; html-webpack-plugin emitted a single page with every chunk",
      );
    }
  }

  // The template becomes the entry (native HTML entry point); the previous
  // entry must be referenced from the template with a `<script>` tag — added
  // to the template file directly when it can be found on disk.
  private migrateEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const templateValue = findings.templateValue as string;
    const entryPair = findPair(configObject, "entry");
    if (!entryPair) {
      const injected = this.injectScriptIntoTemplate(templateValue, "./src/index.js");
      findings.pendingEntry = {
        text: templateValue,
        comment: injected
          ? `The template is now the entry and loads the previous default entry via <script defer src="${injected}"></script>`
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
    const injected = this.injectScriptIntoTemplate(templateValue, unquote(replaceable.text()));
    const comment = injected
      ? `The template is now the entry and loads the previous entry via <script defer src="${injected}"></script>`
      : `The template is now the entry: reference the previous entry from it, e.g. <script defer src=${replaceable.text()}></script> [${this.injectDebug}]`;
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
      this.editor.replace(replaceable, `/* ${comment} */ ${findings.templateValue}`);
    }
  }

  // Add a `<script defer>` tag loading the previous entry to the template file
  // itself. Returns the tag's `src` (relative to the template) on success, or
  // when the template already loads it; `null` falls back to a review comment
  // (no filesystem access, non-relative paths, or files not found on disk).
  private injectScriptIntoTemplate(templateQuoted: string, entryRel: string): string | null {
    const fs = this.fileSystem;
    const path = this.pathModule;
    if (!fs || !path || !this.configFileName) {
      this.injectDebug = `no-modules fs=${Boolean(fs)} path=${Boolean(path)} file=${this.configFileName}`;
      return null;
    }
    const templateRel = unquote(templateQuoted);
    if (!templateRel.startsWith(".") || !entryRel.startsWith(".")) return null;
    try {
      const configDir = path.dirname(this.configFileName);
      const templateFile = path.resolve(configDir, templateRel);
      const entryFile = path.resolve(configDir, entryRel);
      if (!fs.existsSync(templateFile) || !fs.existsSync(entryFile)) {
        this.injectDebug = `missing file=${this.configFileName} dir=${configDir} tpl=${templateFile}(${fs.existsSync(templateFile)}) entry=${entryFile}(${fs.existsSync(entryFile)})`;
        return null;
      }
      const relative = path.relative(path.dirname(templateFile), entryFile).replace(/\\/g, "/");
      const scriptSrc = relative.startsWith(".") ? relative : `./${relative}`;
      const html = fs.readFileSync(templateFile, "utf8");
      // Already loaded (e.g. a re-run) — nothing to write.
      const sourcePattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi;
      for (let match = sourcePattern.exec(html); match; match = sourcePattern.exec(html)) {
        const existing = match[1].startsWith(".") ? match[1] : `./${match[1]}`;
        if (existing === scriptSrc) return scriptSrc;
      }
      fs.writeFileSync(
        templateFile,
        insertScriptTag(html, `<script defer src="${scriptSrc}"></script>`),
      );
      return scriptSrc;
    } catch (error) {
      this.injectDebug = `error ${(error as Error).message}`;
      return null;
    }
  }

  // A string entry value the template path can take over: the value itself, a
  // single-element array, or a single-key object's string value.
  private replaceableEntryValue(entryValue: SgNode<Js>): SgNode<Js> | null {
    if (entryValue.kind() === "string") return entryValue;
    if (entryValue.kind() === "array") {
      const elements = namedChildren(entryValue);
      return elements.length === 1 && elements[0].kind() === "string" ? elements[0] : null;
    }
    if (entryValue.kind() === "object") {
      const entryPairs = pairsOf(entryValue);
      if (entryPairs.length !== 1) return null;
      const inner = entryPairs[0].field("value");
      return inner && inner.kind() === "string" ? inner : null;
    }
    return null;
  }

  // ---------- config-level insertions ----------

  private mergeIntoPlan(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const plan = this.planFor(configObject);
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
      const topProperties: ((indent: string, unit: string) => string)[] = [];
      const pendingEntry = plan.pendingEntry;
      if (pendingEntry) {
        topProperties.push(
          (indent) => `// ${pendingEntry.comment}\n${indent}entry: ${pendingEntry.text}`,
        );
      }
      const outputProps: HtmlProp[] = [];
      const htmlProps = dedupeProps(plan.htmlProps);
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
      return `${commentLines.map((line) => `// ${line}\n${indent}`).join("")}${propertyText}`;
    };
    const value = findPair(config, key)?.field("value");
    if (value && value.kind() === "object") {
      const missing = props.filter((prop) => !findPair(value, prop.name));
      if (!missing.length) return;
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
  let fileSystem: FsModule | null = null;
  let pathModule: PathModule | null = null;
  try {
    fileSystem = await import("node:fs");
    pathModule = await import("node:path");
  } catch {
    // No filesystem access — template edits fall back to review comments.
  }
  return new HtmlMigration(root, fileSystem, pathModule).run();
}

export default transform;

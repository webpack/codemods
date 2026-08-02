import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
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
// Loader options native HTML covers on its own (ESM export of the html string;
// production minification).
const DROPPABLE_LOADER_OPTIONS = new Set(["esModule", "minimize"]);
// Manual migration paths appended to the review comment where one exists.
const LOST_OPTION_HINTS = new Map([
  ["publicPath", "set output.publicPath"],
  ["hash", "use [contenthash] in output.htmlFilename"],
  ["chunks", "use per-entry `html` descriptors"],
  ["excludeChunks", "use per-entry `html` descriptors"],
  ["scriptLoading", "module scripts come from experiments.outputModule"],
  ["minify", "native HTML minifies production output on its own"],
  ["templateContent", "author the page as an .html entry file"],
  ["html-loader.sources", "customize the rule's parser.sources list"],
  [
    "html-loader.preprocessor",
    "move it to the rule's parser.template — synchronous (source, { module, resource }) => string",
  ],
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

interface HtmlProp {
  name: string;
  valueText: string;
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
  outputProps: HtmlProp[];
  needsExperimentsHtml: boolean;
  pendingEntry: { text: string; comment: string } | null;
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
  private pluginMigrated = false;
  private pluginRetained = false;
  // Binding statements rewritten in place (e.g. into the `html` import).
  private readonly repurposedStatements = new Set<number>();

  constructor(root: SgRoot<Js>, fileSystem: FsModule | null, pathModule: PathModule | null) {
    this.editor = new ConfigEditor(root.root());
    this.pluginBindings = collectModuleBindings(this.editor.rootNode, PLUGIN_MODULE);
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
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
    if (this.pluginNames.size) {
      for (const pair of pluginsPairs) this.transformPluginsPair(pair);
    }
    this.migrateHooks();
    this.planConfigInsertions();
    this.editor.finalizeRemovals();
    if (!this.editor.hasEdits) return null;
    for (const binding of this.pluginBindings) {
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
        outputProps: [],
        needsExperimentsHtml: false,
        pendingEntry: null,
      };
      this.configPlans.set(key, plan);
    }
    return plan;
  }

  private describeLost(name: string): string {
    const hint = LOST_OPTION_HINTS.get(name);
    return hint ? `${name} (${hint})` : name;
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
      if (name === "sources" && value) {
        // Booleans map to the rule's parser; source lists need a human.
        if (value.kind() === "true" || value.kind() === "false") {
          findings.parserProps.push({ name: "sources", valueText: value.text() });
        } else {
          findings.lost.push(this.describeLost(`${LOADER_NAME}.sources`));
        }
        continue;
      }
      if (name === "preprocessor") {
        findings.lost.push(this.describeLost(`${LOADER_NAME}.preprocessor`));
        continue;
      }
      findings.lost.push(`${LOADER_NAME}.${name ?? "options"}`);
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
    if (config) this.planFor(config).needsExperimentsHtml = true;
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
    return constructorNode && this.pluginNames.has(constructorNode.text()) ? element : null;
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
    // Several instances mean several pages (`chunks` per page) — per-entry
    // `html` descriptors cover it, but mapping them safely needs a human.
    if (instances.length !== 1) {
      if (instances.length) this.pluginRetained = true;
      return;
    }
    const { element, instantiation } = instances[0];
    const argumentsNode = instantiation.field("arguments");
    const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
    // A non-literal options argument (variable, spread) can't be understood.
    if (optionsObject && optionsObject.kind() !== "object") {
      this.pluginRetained = true;
      return;
    }
    const findings = this.collectFindings(optionsObject);
    if (elements.length === 1) this.editor.markForRemoval(pluginsPair);
    else this.editor.markForRemoval(element);
    if (findings.templateValue !== null) this.migrateEntry(configObject, findings);
    else this.noteMultiPageEntry(configObject, findings);
    this.mergeIntoPlan(configObject, findings);
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

  private collectFindings(optionsObject: SgNode<Js> | undefined): InstanceFindings {
    const findings: InstanceFindings = {
      htmlProps: [],
      htmlFilename: null,
      templateValue: null,
      lost: [],
      notes: [],
      pendingEntry: null,
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
        // Native meta values are `content` strings; attribute objects are not.
        if (
          value.kind() === "object" &&
          pairsOf(value).every((pair) => pair.field("value")?.kind() === "string")
        ) {
          findings.htmlProps.push({ name, valueText: value.text() });
        } else {
          findings.lost.push(this.describeLost(name));
        }
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
        if (templateMode || literal === "defer") break;
        if (literal === "blocking") {
          findings.htmlProps.push({ name, valueText: '"blocking"' });
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
    if (!fs || !path || !this.configFileName) return null;
    const templateRel = unquote(templateQuoted);
    if (!templateRel.startsWith(".") || !entryRel.startsWith(".")) return null;
    try {
      const configDir = path.dirname(this.configFileName);
      const templateFile = path.resolve(configDir, templateRel);
      const entryFile = path.resolve(configDir, entryRel);
      if (!fs.existsSync(templateFile) || !fs.existsSync(entryFile)) return null;
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
    } catch {
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
    plan.needsExperimentsHtml = true;
    if (findings.lost.length) {
      plan.commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[...new Set(findings.lost)].join(", ")}`,
      );
    }
    plan.commentLines.push(...findings.notes);
    if (findings.templateValue === null) {
      const htmlValue = findings.htmlProps.length
        ? `{ ${findings.htmlProps.map((prop) => `${prop.name}: ${prop.valueText}`).join(", ")} }`
        : "true";
      plan.outputProps.push({ name: "html", valueText: htmlValue });
    }
    // The plugin emitted `index.html` by default; native defaults to `[name].html`.
    plan.outputProps.push({ name: "htmlFilename", valueText: findings.htmlFilename ?? '"index.html"' });
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
      if (plan.outputProps.length) {
        this.planObjectProps(plan.config, "output", plan.outputProps, plan.commentLines, topProperties);
      }
      if (plan.needsExperimentsHtml) {
        this.planObjectProps(
          plan.config,
          "experiments",
          [{ name: "html", valueText: "true" }],
          plan.outputProps.length ? [] : plan.commentLines,
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

import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  findPair,
  guardBranchesOf,
  namedChildren,
  unquote,
  unwrapFilterCall,
} from "@webpack/codemod-utils";
import { ConfigPlans } from "../config-plan";
import type { Minification } from "../minification";
import { CompanionPlugins } from "./companions";
import { PLUGIN_MODULE, isRequireOf } from "./bindings";
import { collectFindings, type InstanceFindings, type PageMode } from "./options";
import { migrateEntry, noteMultiPageEntry, replaceableEntryValue } from "./entries";

// Handled by the per-entry migration itself rather than the option mapping.
const MULTI_PAGE_SKIPPED_OPTIONS = new Set(["chunks", "filename"]);

export class HtmlPluginMigration {
  migrated = false;
  retained = false;
  private readonly pluginNames: Set<string>;
  private readonly configFileName: string;

  private readonly editor: ConfigEditor;
  private readonly plans: ConfigPlans;
  private readonly companions: CompanionPlugins;
  private readonly blockedConfigs: Set<number>;

  constructor(
    editor: ConfigEditor,
    plans: ConfigPlans,
    companions: CompanionPlugins,
    blockedConfigs: Set<number>,
    pluginBindings: ModuleBinding[],
  ) {
    this.editor = editor;
    this.plans = plans;
    this.companions = companions;
    this.blockedConfigs = blockedConfigs;

    this.pluginNames = new Set(pluginBindings.map((binding) => binding.name));
    this.configFileName = editor.rootNode.getRoot().filename();
  }

  // The plugin instantiation behind a plugins element, unwrapping guards.
  private pluginInstantiationOf(element: SgNode<Js>): SgNode<Js> | null {
    const branches = guardBranchesOf(element);

    if (branches) {
      for (const branch of branches) {
        const found = this.pluginInstantiationOf(branch);

        if (found) {
          return found;
        }
      }

      return null;
    }

    if (!element.is("new_expression")) {
      return null;
    }

    const constructorNode = element.field("constructor");

    if (!constructorNode) {
      return null;
    }

    if (this.pluginNames.has(constructorNode.text())) {
      return element;
    }

    // `new (require("html-webpack-plugin"))(...)` without a binding.
    const inner = constructorNode.is("parenthesized_expression")
      ? namedChildren(constructorNode)[0] ?? constructorNode
      : constructorNode;

    return isRequireOf(inner, PLUGIN_MODULE) ? element : null;
  }

  transformPluginsPair(pluginsPair: SgNode<Js>): void {
    const configObject = pluginsPair.parent();

    if (!configObject || !configObject.is("object")) {
      return;
    }

    if (this.blockedConfigs.has(configObject.range().start.index)) {
      return;
    }

    const value = unwrapFilterCall(pluginsPair.field("value") ?? pluginsPair);

    if (!value.is("array")) {
      return;
    }

    const elements = namedChildren(value);
    const instances: { element: SgNode<Js>; instantiation: SgNode<Js> }[] = [];

    for (const element of elements) {
      const instantiation = this.pluginInstantiationOf(element);

      if (instantiation) {
        instances.push({ element, instantiation });
      }
    }

    if (!instances.length) {
      return;
    }

    // A computed destination cannot safely receive the native settings.
    if (
      ["output", "experiments"].some((key) => {
        const destination = findPair(configObject, key)?.field("value");

        return destination && !destination.is("object");
      })
    ) {
      this.retained = true;

      return;
    }

    // Every options argument must be an object literal to be understood.
    const optionObjects: (SgNode<Js> | undefined)[] = [];

    for (const { instantiation } of instances) {
      const argumentsNode = instantiation.field("arguments");
      const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;

      if (
        optionsObject &&
        (!optionsObject.is("object") ||
          namedChildren(optionsObject).some((child) => !child.is("pair") && !child.is("comment")))
      ) {
        this.retained = true;

        return;
      }

      const template = optionsObject && findPair(optionsObject, "template")?.field("value");
      const entry = findPair(configObject, "entry")?.field("value");

      if (template && (!template.is("string") || (entry && !replaceableEntryValue(entry)))) {
        this.retained = true;

        return;
      }

      optionObjects.push(optionsObject);
    }

    // Several instances (or a `chunks` list) mean per-entry pages instead of
    // the global `output.html`.
    const firstOptions = optionObjects[0];
    const chunkRestricted =
      instances.length > 1 ||
      (firstOptions !== undefined && findPair(firstOptions, "chunks")?.field("value")?.is("array"));

    if (chunkRestricted) {
      this.migrateMultiPage(configObject, pluginsPair, elements, instances, optionObjects);

      return;
    }

    const findings = collectFindings(firstOptions);
    const plan = this.plans.planFor(configObject);
    const mode: PageMode = findings.templateValue !== null ? "template" : "single";

    if (findings.templateValue !== null) {
      migrateEntry(this.editor, this.configFileName, configObject, findings);
    } else {
      noteMultiPageEntry(configObject, findings);
    }

    this.mergeIntoPlan(configObject, findings);

    const siblingRemoved = this.companions.processSiblings(
      elements,
      [instances[0].element],
      mode,
      plan,
    );

    this.removeInstances(pluginsPair, elements, [instances[0].element, ...siblingRemoved]);
    this.migrated = true;
  }

  private removeInstances(
    pluginsPair: SgNode<Js>,
    elements: SgNode<Js>[],
    removedElements: SgNode<Js>[],
  ): void {
    if (removedElements.length === elements.length) {
      this.editor.markForRemoval(pluginsPair);
    } else {
      for (const element of removedElements) {
        this.editor.markForRemoval(element);
      }
    }
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
      this.retained = true;

      return;
    }

    const plan = this.plans.planFor(configObject);
    const pages: { entryDescriptor: SgNode<Js>; htmlValue: string }[] = [];
    const minification: Minification[] = [];
    const lost: string[] = [];
    let moduleScripts = false;

    for (const options of optionObjects) {
      // Each page needs exactly one owning entry in `chunks`.
      const chunksValue = options ? findPair(options, "chunks")?.field("value") : undefined;
      const chunkNames = chunksValue?.is("array") ? namedChildren(chunksValue) : [];

      if (!options || chunkNames.length !== 1 || !chunkNames[0].is("string")) {
        this.retained = true;

        return;
      }

      const chunkName = unquote(chunkNames[0].text());
      const entryDescriptor = findPair(entryValue, chunkName)?.field("value");

      if (!entryDescriptor) {
        this.retained = true;

        return;
      }

      if (findPair(options, "template") || findPair(options, "templateContent")) {
        this.retained = true;

        return;
      }

      const findings = collectFindings(options, MULTI_PAGE_SKIPPED_OPTIONS);

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
      this.retained = true;

      return;
    }

    plan.minification.push(...minification);

    const siblingRemoved = this.companions.processSiblings(
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
    this.plans.requireExperimentsHtml(plan);
    this.plans.applyModuleScripts(plan, moduleScripts);
    plan.htmlFilename ??= '"[name].html"';

    if (lost.length) {
      plan.commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[
          ...new Set(lost),
        ].join(", ")}`,
      );
    }

    this.migrated = true;
  }

  private mergeIntoPlan(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const plan = this.plans.planFor(configObject);

    plan.minification.push(findings.minification);
    plan.pluginMigratedHere = true;
    this.plans.requireExperimentsHtml(plan);

    if (findings.lost.length) {
      plan.commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[
          ...new Set(findings.lost),
        ].join(", ")}`,
      );
    }

    plan.commentLines.push(...findings.notes);

    if (findings.templateValue === null) {
      plan.htmlEnabled = true;
    }

    plan.htmlProps.push(...findings.htmlProps);
    this.plans.applyModuleScripts(plan, findings.scriptLoadingModule);
    // The plugin emitted `index.html` by default; native defaults to `[name].html`.
    plan.htmlFilename ??= findings.htmlFilename ?? '"index.html"';
    plan.pendingEntry = findings.pendingEntry;
  }
}

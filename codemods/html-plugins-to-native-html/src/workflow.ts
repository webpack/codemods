import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import { parse } from "codemod:ast-grep";
import { ConfigEditor, collectModuleBindings, keyName } from "@webpack/codemod-utils";

import { ConfigPlans } from "./config-plan";
import { HtmlLoaderRules } from "./loaders/rules";
import { recordSource } from "./migration-state";
import { sourcePackageReferences } from "./package-references";
import { PLUGIN_MODULE } from "./plugins/bindings";
import { CompanionPlugins } from "./plugins/companions";
import { HtmlPluginHooks } from "./plugins/hooks";
import { HtmlPluginMigration } from "./plugins/migration";

function migrateConfiguration(root: SgRoot<Js>): string | null {
  const editor = new ConfigEditor(root.root());
  const bindings = collectModuleBindings(editor.rootNode, PLUGIN_MODULE);
  const hooks = new HtmlPluginHooks(editor, bindings);

  // A tap on an unavailable native stage keeps the entire file unchanged.
  if (hooks.usesUnmappableHooks()) {
    return null;
  }

  const usePairs: SgNode<Js>[] = [];
  const loaderPairs: SgNode<Js>[] = [];
  const pluginsPairs: SgNode<Js>[] = [];

  for (const pair of editor.rootNode.findAll({ rule: { kind: "pair" } })) {
    const name = keyName(pair);

    if (name === "use") {
      usePairs.push(pair);
    } else if (name === "loader") {
      loaderPairs.push(pair);
    } else if (name === "plugins") {
      pluginsPairs.push(pair);
    }
  }

  const plans = new ConfigPlans(editor);
  const companions = new CompanionPlugins(editor);
  const blockedConfigs = companions.findUnsupportedConfigs(pluginsPairs);
  const rules = new HtmlLoaderRules(editor, plans, blockedConfigs);
  const plugins = new HtmlPluginMigration(editor, plans, companions, blockedConfigs, bindings);

  // Retained loaders and companion plugins must be identified before plugins
  // or templates are changed in their owning configuration.
  rules.transformRules(usePairs, loaderPairs);

  for (const pair of pluginsPairs) {
    plugins.transformPluginsPair(pair);
  }

  if (plugins.migrated && !plugins.retained && !blockedConfigs.size) {
    hooks.migrateHooks();
  }

  plans.planConfigInsertions();
  editor.finalizeRemovals();

  if (!editor.hasEdits) {
    return null;
  }

  for (const binding of [...bindings, ...companions.bindings]) {
    if (hooks.repurposedStatements.has(binding.statement.range().start.index)) {
      continue;
    }

    editor.removeBindingIfUnused(binding);
  }

  return editor.commit();
}

export default async function transform(root: SgRoot<Js>): Promise<string | null> {
  const result = migrateConfiguration(root);
  const language =
    root.filename().endsWith(".jsx") || root.filename().endsWith(".tsx") ? "tsx" : "typescript";
  const migrated = result === null ? root.root() : parse<Js>(language, result).root();

  recordSource(root.filename(), sourcePackageReferences(migrated));

  return result;
}

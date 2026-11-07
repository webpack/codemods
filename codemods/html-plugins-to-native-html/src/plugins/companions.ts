import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  collectModuleBindings,
  findPair,
  guardBranchesOf,
  keyName,
  namedChildren,
  pairsOf,
  unwrapFilterCall,
} from "@webpack/codemod-utils";
import type { ConfigPlan, HtmlProp } from "../config-plan";
import type { PageMode } from "./options";
import { collectNamedBindings, isRequireOf } from "./bindings";

// Companion plugins that extended html-webpack-plugin; each maps to one
// `output.html` option. Only migrated alongside a migrated html-webpack-plugin.
const CSP_MODULE = "csp-html-webpack-plugin";

const SRI_MODULE = "webpack-subresource-integrity";

const FAVICONS_MODULE = "favicons-webpack-plugin";

const SIBLING_PLUGIN_MODULES = [CSP_MODULE, SRI_MODULE, FAVICONS_MODULE];

export class CompanionPlugins {
  readonly bindings: ModuleBinding[] = [];
  private readonly siblingNameToModule = new Map<string, string>();

  private readonly editor: ConfigEditor;

  constructor(editor: ConfigEditor) {
    this.editor = editor;

    for (const moduleName of SIBLING_PLUGIN_MODULES) {
      const named = collectNamedBindings(editor.rootNode, moduleName);

      for (const binding of [...collectModuleBindings(editor.rootNode, moduleName), ...named]) {
        if (this.siblingNameToModule.has(binding.name)) {
          continue;
        }

        this.bindings.push(binding);
        this.siblingNameToModule.set(binding.name, moduleName);
      }
    }
  }

  findUnsupportedConfigs(pluginsPairs: SgNode<Js>[]): Set<number> {
    const blockedConfigs = new Set<number>();

    // Dynamic favicon inputs need manual migration. Keep their HTML plugin
    // too, because the companion relies on its hooks.
    for (const pair of pluginsPairs) {
      const value = unwrapFilterCall(pair.field("value") ?? pair);

      if (!value.is("array")) {
        continue;
      }

      if (
        namedChildren(value).some((element) => {
          const sibling = this.siblingInstantiationOf(element);

          return sibling?.module === FAVICONS_MODULE && !this.faviconLogo(sibling.instantiation);
        })
      ) {
        const config = pair.parent();

        if (config) {
          blockedConfigs.add(config.range().start.index);
        }
      }
    }

    return blockedConfigs;
  }

  private faviconLogo(instantiation: SgNode<Js>): SgNode<Js> | null {
    const argsNode = instantiation.field("arguments");
    const args = argsNode ? namedChildren(argsNode).filter((node) => !node.is("comment")) : [];

    if (args.length !== 1) {
      return null;
    }

    const option = args[0];

    if (option.is("string")) {
      return option;
    }

    if (
      !option.is("object") ||
      namedChildren(option).some((node) => !node.is("pair") && !node.is("comment"))
    ) {
      return null;
    }

    const logo = findPair(option, "logo")?.field("value");

    return logo?.is("string") ? logo : null;
  }

  private siblingInstantiationOf(
    element: SgNode<Js>,
  ): { instantiation: SgNode<Js>; module: string } | null {
    const branches = guardBranchesOf(element);

    if (branches) {
      for (const branch of branches) {
        const found = this.siblingInstantiationOf(branch);

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

    const inner = constructorNode.is("parenthesized_expression")
      ? namedChildren(constructorNode)[0]
      : constructorNode;
    const module =
      this.siblingNameToModule.get(constructorNode.text()) ??
      SIBLING_PLUGIN_MODULES.find((name) => inner && isRequireOf(inner, name));

    return module ? { instantiation: element, module } : null;
  }

  // Companion plugins piggybacked on html-webpack-plugin, so they only migrate
  // (or make sense at all) next to a migrated instance. Returns the elements
  // to remove alongside it.
  processSiblings(
    elements: SgNode<Js>[],
    hwpElements: SgNode<Js>[],
    mode: PageMode,
    plan: ConfigPlan,
  ): SgNode<Js>[] {
    const hwpStarts = new Set(hwpElements.map((element) => element.range().start.index));
    const removed: SgNode<Js>[] = [];

    for (const element of elements) {
      if (hwpStarts.has(element.range().start.index)) {
        continue;
      }

      const sibling = this.siblingInstantiationOf(element);

      if (!sibling) {
        continue;
      }

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

      if (!policy) {
        props.push({ name: "csp", valueText: "true" });
      } else if (policy.is("object")) {
        props.push({ name: "csp", valueText: `{ policy: ${policy.text()} }` });
      } else {
        return false;
      }

      const options = args[1];

      if (options && options.is("object")) {
        for (const optionPair of pairsOf(options)) {
          lost.push(keyName(optionPair) ?? "options");
        }
      } else if (options) {
        lost.push("options");
      }
    } else if (module === SRI_MODULE) {
      let integrity = "true";
      let enabled = true;
      const options = args[0];

      if (options && !options.is("object")) {
        return false;
      }

      if (options) {
        for (const optionPair of pairsOf(options)) {
          const name = keyName(optionPair);
          const value = optionPair.field("value");

          if (name === "hashFuncNames" && value?.is("array")) {
            integrity = value.text();
          } else if (name === "enabled" && value?.is("false")) {
            enabled = false;
          } else if (name === "enabled") {
            continue;
          } else {
            lost.push(name ?? "options");
          }
        }
      }

      if (enabled) {
        props.push({ name: "integrity", valueText: integrity });
      }
    } else if (module === FAVICONS_MODULE) {
      const logo = this.faviconLogo(instantiation);

      if (!logo) {
        return false;
      }

      props.push({ name: "favicon", valueText: logo.text() });

      if (args[0]?.is("object")) {
        for (const pair of pairsOf(args[0])) {
          if (keyName(pair) !== "logo") {
            lost.push(keyName(pair) ?? "options");
          }
        }
      }

      plan.commentLines.push(
        "Review: native favicon emits the source icon only; generate the required icon sizes/formats and web app manifest manually, then configure their links in output.html or the HTML template",
      );
    } else {
      return false;
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
        `Removed ${
          module === FAVICONS_MODULE ? "favicon generator" : module
        } options without a native HTML equivalent: ${[...new Set(lost)].join(", ")}`,
      );
    }

    return true;
  }
}

import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  addImport,
  collectModuleBindings,
  lineIndent,
  namedChildren,
} from "@webpack/codemod-utils";

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
  [
    "transformHtml",
    "transformHtml receives (html, { outputName }) and must return the html string",
  ],
  ["htmlEmitted", "htmlEmitted receives ({ outputName }); nothing to return"],
]);

// Stages webpack handles itself — a tap on them cannot be carried over, so
// files using them are left untouched.
const UNMAPPABLE_HOOKS = new Set(["beforeAssetTagGeneration", "afterTemplateExecution"]);

export class HtmlPluginHooks {
  readonly repurposedStatements = new Set<number>();
  private readonly pluginNames: Set<string>;

  private readonly editor: ConfigEditor;
  private readonly pluginBindings: ModuleBinding[];

  constructor(editor: ConfigEditor, pluginBindings: ModuleBinding[]) {
    this.editor = editor;
    this.pluginBindings = pluginBindings;

    this.pluginNames = new Set(pluginBindings.map((binding) => binding.name));
  }

  usesUnmappableHooks(): boolean {
    if (!this.pluginNames.size || !this.pluginHookReceivers().length) {
      return false;
    }

    for (const node of this.pluginHookProperties()) {
      if (UNMAPPABLE_HOOKS.has(node.text())) {
        return true;
      }
    }

    return false;
  }

  // `X.getHooks(...)` / `X.getCompilationHooks(...)` receivers on the plugin.
  private pluginHookReceivers(): SgNode<Js>[] {
    const receivers: SgNode<Js>[] = [];

    for (const node of this.editor.rootNode.findAll({ rule: { kind: "member_expression" } })) {
      const property = node.field("property")?.text();

      if (property !== "getHooks" && property !== "getCompilationHooks") {
        continue;
      }

      const objectPart = node.field("object");

      if (objectPart && this.pluginNames.has(objectPart.text())) {
        receivers.push(node);
      }
    }

    return receivers;
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

        if (property) {
          properties.push(property);
        }
      } else if (access?.is("variable_declarator")) {
        const name = access.field("name");

        if (name?.is("object_pattern")) {
          for (const member of namedChildren(name)) {
            const key = member.is("pair_pattern") ? member.field("key") : member;

            if (key) {
              properties.push(key);
            }
          }
        } else if (name?.is("identifier")) {
          for (const member of this.editor.rootNode.findAll({
            rule: { kind: "member_expression" },
          })) {
            if (member.field("object")?.text() !== name.text()) {
              continue;
            }

            const property = member.field("property");

            if (property) {
              properties.push(property);
            }
          }
        }
      }
    }

    return properties;
  }

  // Retarget `HtmlWebpackPlugin.getHooks(...)` taps to the native
  // `HtmlModulesPlugin.getCompilationHooks(...)` stages. Only done when this
  // file's plugin setup was actually migrated and no instance survives.
  migrateHooks(): void {
    const receivers = this.pluginHookReceivers();

    if (!receivers.length) {
      return;
    }

    const nativeReceiver = this.nativeHooksReceiver();

    for (const node of receivers) {
      this.editor.replace(node, `${nativeReceiver}.getCompilationHooks`);
    }

    // One review comment per statement holding a renamed tap.
    const commentedStatements = new Set<string>();

    for (const property of this.pluginHookProperties()) {
      const renamed = HOOK_RENAMES.get(property.text());

      if (!renamed) {
        continue;
      }

      this.editor.replace(
        property,
        property.is("shorthand_property_identifier_pattern")
          ? `${renamed}: ${property.text()}`
          : renamed,
      );

      const statement = this.statementOf(property);
      const review = HOOK_REVIEW_COMMENTS.get(renamed);

      if (!statement || !review) {
        continue;
      }

      const key = `${statement.range().start.index}:${renamed}`;

      if (commentedStatements.has(key)) {
        continue;
      }

      commentedStatements.add(key);

      if (
        receivers.some((receiver) => receiver.range().start.index === statement.range().start.index)
      ) {
        // An insertion at the same position as the receiver replacement would
        // be swallowed by commitEdits. A trailing comment avoids the overlap.
        this.editor.insertAfter(statement, ` /* Review: ${review} */`);

        continue;
      }

      const lineStart = this.editor.source.lastIndexOf("\n", statement.range().start.index - 1) + 1;
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

      if (!parent) {
        return null;
      }

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

    if (webpackBindings.length) {
      return `${webpackBindings[0].name}.html.HtmlModulesPlugin`;
    }

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

      if (edit) {
        this.editor.addEdit(edit);
      }
    }

    return "html.HtmlModulesPlugin";
  }
}

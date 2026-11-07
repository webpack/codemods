import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { type ModuleBinding, namedChildren, unquote } from "@webpack/codemod-utils";

export const PLUGIN_MODULE = "html-webpack-plugin";

export function isRequireOf(node: SgNode<Js>, moduleName: string): boolean {
  if (!node.is("call_expression")) return false;
  const callee = node.field("function");
  if (!callee || !callee.is("identifier") || callee.text() !== "require") return false;
  const argumentsNode = node.field("arguments");
  const args = argumentsNode ? namedChildren(argumentsNode) : [];
  return args.length === 1 && args[0].is("string") && unquote(args[0].text()) === moduleName;
}

// Named bindings (`import { X }` / `const { X } = require(...)`) — e.g.
// webpack-subresource-integrity's named export, which the default-import
// resolution doesn't cover. Only single-name patterns, so removing the
// statement can never drop another binding.
export function collectNamedBindings(rootNode: SgNode<Js>, moduleName: string): ModuleBinding[] {
  const bindings: ModuleBinding[] = [];
  for (const statement of rootNode.findAll({ rule: { kind: "import_statement" } })) {
    const source = statement.field("source");
    if (!source || unquote(source.text()) !== moduleName) continue;
    const specifiers = statement.findAll({ rule: { kind: "import_specifier" } });
    if (specifiers.length !== 1) continue;
    const local = specifiers[0].field("alias") ?? specifiers[0].field("name");
    if (local) bindings.push({ name: local.text(), statement });
  }
  for (const kind of ["lexical_declaration", "variable_declaration"] as const) {
    for (const statement of rootNode.findAll({ rule: { kind } })) {
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

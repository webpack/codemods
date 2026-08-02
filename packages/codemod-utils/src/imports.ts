import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";

import { namedChildren, unquote } from "./ast";

// A top-level `require`/`import` binding of a given module.
export interface ModuleBinding {
  name: string;
  statement: SgNode<Js>;
}

export function unwrapParens(node: SgNode<Js>): SgNode<Js> {
  let current = node;
  while (current.kind() === "parenthesized_expression") {
    const inner = namedChildren(current)[0];
    if (!inner) return current;
    current = inner;
  }
  return current;
}

// The module name of a `require("...")` call — parenthesized forms like
// `(require)("...")` included — or null when the node is anything else.
export function requireCallSource(node: SgNode<Js>): string | null {
  const call = unwrapParens(node);
  if (call.kind() !== "call_expression") return null;
  const callee = call.field("function");
  if (!callee || unwrapParens(callee).text() !== "require") return null;
  const argumentsNode = call.field("arguments");
  const args = argumentsNode ? namedChildren(argumentsNode) : [];
  if (args.length !== 1 || args[0].kind() !== "string") return null;
  return unquote(args[0].text());
}

// Top-level `require`/`import` bindings of the given module, matched
// structurally so aliased/parenthesized forms are covered too.
export function collectModuleBindings(rootNode: SgNode<Js>, moduleName: string): ModuleBinding[] {
  const bindings: ModuleBinding[] = [];
  for (const statement of rootNode.findAll({ rule: { kind: "import_statement" } })) {
    const source = statement.field("source");
    if (!source || unquote(source.text()) !== moduleName) continue;
    const clause = statement.children().find((child) => child.kind() === "import_clause");
    const defaultImport = clause
      ? namedChildren(clause).find((child) => child.kind() === "identifier")
      : undefined;
    if (defaultImport) bindings.push({ name: defaultImport.text(), statement });
  }
  for (const declarator of rootNode.findAll({ rule: { kind: "variable_declarator" } })) {
    const name = declarator.field("name");
    const value = declarator.field("value");
    if (!name || name.kind() !== "identifier" || !value) continue;
    if (requireCallSource(value) !== moduleName) continue;
    const statement = declarator.parent();
    if (!statement) continue;
    // Multi-declarator statements can't be removed wholesale — leave them alone.
    const declaratorCount = namedChildren(statement).filter(
      (child) => child.kind() === "variable_declarator",
    ).length;
    if (declaratorCount !== 1) continue;
    bindings.push({ name: name.text(), statement });
  }
  return bindings;
}

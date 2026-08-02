import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { getAllImports } from "@jssg/utils/javascript/imports";

import { namedChildren } from "./ast";

export { addImport } from "@jssg/utils/javascript/imports";

// A top-level `require`/`import` binding of a given module.
export interface ModuleBinding {
  name: string;
  statement: SgNode<Js>;
}

// The whole removable statement behind a binding identifier: its import
// statement, or its variable statement when it declares nothing else.
function bindingStatementOf(identifier: SgNode<Js>): SgNode<Js> | null {
  let current = identifier.parent();
  while (current) {
    const kind = current.kind();
    if (kind === "import_statement") return current;
    if (kind === "lexical_declaration" || kind === "variable_declaration") {
      const declarators = namedChildren(current).filter(
        (child) => child.kind() === "variable_declarator",
      );
      return declarators.length === 1 ? current : null;
    }
    current = current.parent();
  }
  return null;
}

// Top-level `require`/`import` bindings of the given module, resolved by
// @jssg/utils (ESM, CJS, aliases, namespace, dynamic import).
export function collectModuleBindings(rootNode: SgNode<Js>, moduleName: string): ModuleBinding[] {
  const bindings: ModuleBinding[] = [];
  const seen = new Set<string>();
  const program = rootNode as SgNode<Js, "program">;
  for (const resolved of getAllImports(program, { type: "default", from: moduleName })) {
    const statement = bindingStatementOf(resolved.node);
    if (!statement || seen.has(resolved.alias)) continue;
    seen.add(resolved.alias);
    bindings.push({ name: resolved.alias, statement });
  }
  return bindings;
}

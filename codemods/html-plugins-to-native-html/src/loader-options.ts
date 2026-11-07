import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, keyName, namedChildren, unquote } from "@webpack/codemod-utils";

// The native parser accepts the list directly. Loader callbacks have different
// signatures, so retain rules with filters, functions, spreads or dynamic lists.
export function nativeSources(value: SgNode<Js>): { text: string; extendsDefaults: boolean } | null {
  if (value.kind() === "true" || value.kind() === "false") return { text: value.text(), extendsDefaults: false };
  if (value.kind() !== "object") return null;
  const options = namedChildren(value).filter((node) => node.kind() !== "comment");
  if (!options.length) return { text: "true", extendsDefaults: false };
  if (options.length !== 1 || keyName(options[0]) !== "list") return null;
  const list = options[0].field("value");
  if (list?.kind() !== "array") return null;
  for (const source of namedChildren(list)) {
    if (source.kind() === "comment") continue;
    if (source.kind() === "string" && unquote(source.text()) === "...") continue;
    if (source.kind() !== "object") return null;
    const properties = namedChildren(source).filter((node) => node.kind() !== "comment");
    const names = properties.map(keyName);
    if (new Set(names).size !== names.length) return null;
    if (!findPair(source, "attribute") || !findPair(source, "type")) return null;
    for (const property of properties) {
      const name = keyName(property);
      const option = property.field("value");
      if (!name || !["tag", "attribute", "type"].includes(name) || !option) return null;
      if (name === "type") {
        if (option.kind() !== "string" || !["src", "srcset"].includes(unquote(option.text()))) return null;
      } else if (option.kind() !== "string") return null;
    }
  }
  return {
    text: list.text(),
    extendsDefaults: namedChildren(list).some((node) => node.kind() === "string" && unquote(node.text()) === "..."),
  };
}

const STRING_METHODS = new Set([
  "concat", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll",
  "slice", "substring", "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart",
]);

function returnsString(node: SgNode<Js> | null, strings: Set<string>): boolean {
  if (!node) return false;
  if (node.kind() === "string" || node.kind() === "template_string") return true;
  if (node.kind() === "identifier") return strings.has(node.text());
  if (node.kind() === "parenthesized_expression") return returnsString(namedChildren(node)[0], strings);
  if (node.kind() === "binary_expression" && node.field("operator")?.text() === "+") {
    return returnsString(node.field("left"), strings) || returnsString(node.field("right"), strings);
  }
  if (node.kind() === "ternary_expression") {
    return returnsString(node.field("consequence"), strings) && returnsString(node.field("alternative"), strings);
  }
  if (node.kind() === "call_expression") {
    const callee = node.field("function");
    return callee?.kind() === "member_expression"
      && STRING_METHODS.has(callee.field("property")?.text() ?? "")
      && returnsString(callee.field("object"), strings);
  }
  return false;
}

// Native templates must synchronously return a string. Limit automatic migration
// to inline string transforms whose result we can establish without executing
// user code. LoaderContext and async/unknown calls require manual adaptation.
export function nativeTemplate(value: SgNode<Js>): string | null {
  if (!["arrow_function", "function_expression"].includes(value.kind())) return null;
  if (value.children().some((node) => node.kind() === "async")) return null;
  if (value.findAll({ rule: { any: [
    { kind: "await_expression" }, { kind: "this" },
    { kind: "assignment_expression" }, { kind: "augmented_assignment_expression" },
    { kind: "update_expression" }, { pattern: "arguments" },
  ] } }).length) return null;
  const parameters = value.field("parameters");
  const parameter = value.field("parameter");
  const params = parameters ? namedChildren(parameters).filter((node) => node.kind() !== "comment") : parameter ? [parameter] : [];
  if (params.length > 1) return null;
  const name = params[0]?.field("pattern") ?? params[0];
  if (name && name.kind() !== "identifier") return null;
  const strings = new Set(name ? [name.text()] : []);
  const body = value.field("body");
  if (!body) return null;
  if (body.kind() !== "statement_block") return returnsString(body, strings) ? value.text() : null;
  const statements = namedChildren(body).filter((node) => node.kind() !== "comment");
  const last = statements.pop();
  if (last?.kind() !== "return_statement") return null;
  for (const statement of statements) {
    if (statement.kind() !== "lexical_declaration" || !statement.text().startsWith("const ")) return null;
    for (const declaration of namedChildren(statement).filter((node) => node.kind() !== "comment")) {
      const binding = declaration.field("name");
      if (binding?.kind() !== "identifier" || !returnsString(declaration.field("value"), strings)) return null;
      strings.add(binding.text());
    }
  }
  return returnsString(namedChildren(last).find((node) => node.kind() !== "comment") ?? null, strings) ? value.text() : null;
}

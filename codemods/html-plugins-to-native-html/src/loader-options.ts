import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, keyName, namedChildren, unquote } from "@webpack/codemod-utils";

function callbackParameters(value: SgNode<Js>): SgNode<Js>[] | null {
  if (!["arrow_function", "function_expression"].includes(value.kind())) return null;
  if (value.children().some((node) => node.kind() === "async")) return null;
  if (value.findAll({ rule: { any: [{ kind: "this" }, { pattern: "arguments" }] } }).length) return null;
  const parameters = value.field("parameters");
  const parameter = value.field("parameter");
  const params = parameters ? namedChildren(parameters).filter((node) => node.kind() !== "comment") : parameter ? [parameter] : [];
  const names = params.map((param) => param.field("pattern") ?? param);
  return names.every((name) => name.kind() === "identifier") ? names : null;
}

function usesParameter(value: SgNode<Js>, params: SgNode<Js>[], index: number): boolean {
  const param = params[index];
  return !!param && !!value.field("body")?.findAll({ rule: { pattern: param.text() } }).length;
}

function constantBoolean(value: SgNode<Js>): string | null {
  if (!callbackParameters(value)) return null;
  let body = value.field("body");
  if (body?.kind() === "statement_block") {
    const statements = namedChildren(body).filter((node) => node.kind() !== "comment");
    if (statements.length !== 1 || statements[0].kind() !== "return_statement") return null;
    body = namedChildren(statements[0])[0] ?? null;
  }
  return body?.kind() === "true" || body?.kind() === "false" ? body.text() : null;
}

function freshName(source: string, base: string): string {
  while (source.includes(base)) base += "_";
  return base;
}

// Source filters run per attribute in both APIs, but native attributes are a
// Map and the native callback has no tag name or resource path arguments.
function sourceFilter(value: SgNode<Js>, tag: string | null, attribute: string, attrs: string, typescript: boolean): string | null {
  const params = callbackParameters(value);
  if (!params || params.length > 4 || usesParameter(value, params, 3)) return null;
  if ((!tag || tag === "*") && usesParameter(value, params, 0)) return null;
  // parse5's foreign attribute namespace metadata is not exposed by native HTML.
  if (usesParameter(value, params, 2) && /\b(namespace|prefix)\b/.test(value.text())) return null;
  const args = [JSON.stringify(tag ?? ""), JSON.stringify(attribute), `Array.from(${attrs}, ([name, value]) => ({ name, value }))`, typescript ? "undefined as never" : "undefined"];
  return `(${value.text()})(${args.slice(0, params.length).join(", ")})`;
}

export function nativeSources(value: SgNode<Js>, typescript = false): { text: string; extendsDefaults: boolean } | null {
  if (value.kind() === "true" || value.kind() === "false") return { text: value.text(), extendsDefaults: false };
  if (value.kind() !== "object") return null;
  const options = namedChildren(value).filter((node) => node.kind() !== "comment");
  if (!options.length) return { text: "true", extendsDefaults: false };
  const keys = options.map(keyName);
  if (new Set(keys).size !== keys.length || keys.some((key) => !key || !["list", "urlFilter", "scriptingEnabled"].includes(key))) return null;
  const scripting = findPair(value, "scriptingEnabled")?.field("value");
  if (scripting && scripting.kind() !== "true") return null;
  const urlFilter = findPair(value, "urlFilter")?.field("value");
  const urlConstant = urlFilter ? constantBoolean(urlFilter) : "true";
  if (urlConstant === "false") return { text: "false", extendsDefaults: false };
  const list = findPair(value, "list")?.field("value");
  if (!list) return urlConstant === "true" ? { text: "true", extendsDefaults: false } : null;
  if (list.kind() !== "array") return null;
  const urlParams = urlFilter ? callbackParameters(urlFilter) : [];
  if (urlConstant === null && (!urlParams || urlParams.length > 3 || usesParameter(urlFilter!, urlParams, 2))) return null;
  const edits = [];
  for (const source of namedChildren(list)) {
    if (source.kind() === "comment") continue;
    if (source.kind() === "string" && unquote(source.text()) === "...") {
      if (urlConstant === null) return null;
      continue;
    }
    if (source.kind() !== "object") return null;
    const properties = namedChildren(source).filter((node) => node.kind() !== "comment");
    const names = properties.map(keyName);
    if (new Set(names).size !== names.length) return null;
    if (!findPair(source, "attribute") || !findPair(source, "type")) return null;
    for (const property of properties) {
      const name = keyName(property);
      const option = property.field("value");
      if (!name || !["tag", "attribute", "type", "filter"].includes(name) || !option) return null;
      if (name === "filter") continue;
      if (name === "type") {
        if (option.kind() !== "string" || !["src", "srcset"].includes(unquote(option.text()))) return null;
      } else if (option.kind() !== "string") return null;
    }
    const filter = findPair(source, "filter")?.field("value");
    if (!filter && urlConstant === "true") continue;
    const tagNode = findPair(source, "tag")?.field("value");
    const tag = tagNode ? unquote(tagNode.text()).toLowerCase() : null;
    const attribute = unquote(findPair(source, "attribute")!.field("value")!.text()).toLowerCase();
    const type = findPair(source, "type")!.field("value")!;
    // urlFilter sees each parsed srcset candidate, while a native source filter
    // sees the entire attribute. Do not turn a per-URL decision into all-or-none.
    if (urlConstant === null && unquote(type.text()) !== "src") return null;
    const attrs = freshName(value.text(), "htmlAttributes");
    const url = freshName(value.text(), "htmlUrl");
    const conditions: string[] = [];
    if (filter) {
      const condition = sourceFilter(filter, tag, attribute, attrs, typescript);
      if (condition === null) return null;
      conditions.push(condition);
    }
    if (urlFilter && urlConstant === null) {
      const normalized = `${url}.replace(/^[\\t\\n\\f\\r ]+|[\\t\\n\\f\\r ]+$/g, "").replace(/^[\\u0001-\\u0019\\u00a0]+|[\\u0001-\\u0019\\u00a0]+$/g, "")`;
      const args = [JSON.stringify(attribute), normalized, typescript ? "undefined as never" : "undefined"];
      conditions.push(`(${urlFilter.text()})(${args.slice(0, urlParams!.length).join(", ")})`);
    }
    const parameters = urlConstant === null
      ? `${attrs}${typescript ? ": Map<string, string>" : ""}, ${url}${typescript ? ": string" : ""}`
      : `${attrs}${typescript ? ": Map<string, string>" : ""}`;
    const mapped = properties.filter((property) => keyName(property) !== "filter").map((property) => property.text());
    mapped.push(`filter: (${parameters}) => ${conditions.join(" && ")}`);
    edits.push(source.replace(`{ ${mapped.join(", ")} }`));
  }
  return {
    text: edits.length ? list.commitEdits(edits) : list.text(),
    extendsDefaults: namedChildren(list).some((node) => node.kind() === "string" && unquote(node.text()) === "..."),
  };
}

const STRING_METHODS = new Set([
  "concat", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll",
  "slice", "substring", "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart",
]);

const CONTEXT_METHODS = new Map([
  ["addDependency", "(dependency: string) => void"],
  ["addContextDependency", "(dependency: string) => void"],
  ["addMissingDependency", "(dependency: string) => void"],
  ["addBuildDependency", "(dependency: string) => void"],
  ["emitWarning", "(warning: Error) => void"],
  ["emitError", "(error: Error) => void"],
]);

function adaptTemplateContext(value: SgNode<Js>, context: SgNode<Js>, typescript: boolean): string | null {
  const body = value.field("body")!;
  const edits = [];
  const properties = new Map<string, string>();
  const name = context.text();
  const resourcePattern = '/^((?:\\0.|[^?#\\0])*)(\\?(?:\\0.|[^#\\0])*)?(#.*)?$/';
  for (const reference of body.findAll({ rule: { kind: "identifier" } }).filter((node) => node.text() === name)) {
    const member = reference.parent();
    if (member?.kind() !== "member_expression" || member.field("object")?.range().start.index !== reference.range().start.index) return null;
    const property = member.field("property")?.text();
    if (!property) return null;
    if (CONTEXT_METHODS.has(property)) properties.set(property, CONTEXT_METHODS.get(property)!);
    else if (property === "context") {
      properties.set("module", "{ context: string }");
      edits.push(member.replace(`${name}.module.context`));
    } else if (["resource", "resourcePath", "resourceQuery", "resourceFragment"].includes(property)) {
      properties.set("resource", "string");
      if (property === "resourcePath") {
        edits.push(member.replace(`${name}.resource.replace(${resourcePattern}, "$1").replace(/\\0(.)/g, "$1")`));
      } else if (property === "resourceQuery") {
        edits.push(member.replace(`(${name}.resource.match(${resourcePattern})?.[2]?.replace(/\\0(.)/g, "$1") ?? "")`));
      } else if (property === "resourceFragment") {
        edits.push(member.replace(`(${name}.resource.match(${resourcePattern})?.[3] ?? "")`));
      }
    } else return null;
  }
  if (typescript) {
    const parameter = namedChildren(value.field("parameters")!).filter((node) => node.kind() !== "comment")[1];
    const type = parameter.field("type");
    const text = `: { ${[...properties].map(([key, type]) => `${key}: ${type}`).join("; ")} }`;
    if (type) edits.push(type.replace(text));
    else edits.push({ startPos: context.range().end.index, endPos: context.range().end.index, insertedText: text });
  }
  return edits.length ? value.commitEdits(edits) : value.text();
}

function returnsString(node: SgNode<Js> | null, strings: Set<string>): boolean {
  if (!node) return false;
  if (node.kind() === "string" || node.kind() === "template_string") return true;
  if (node.kind() === "identifier" || node.kind() === "member_expression") return strings.has(node.text());
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
export function nativeTemplate(value: SgNode<Js>, typescript = false): string | null {
  if (!["arrow_function", "function_expression"].includes(value.kind())) return null;
  if (value.children().some((node) => node.kind() === "async")) return null;
  if (value.findAll({ rule: { any: [
    { kind: "await_expression" }, { kind: "this" },
    { kind: "assignment_expression" }, { kind: "augmented_assignment_expression" },
    { kind: "update_expression" }, { pattern: "arguments" },
  ] } }).length) return null;
  const params = callbackParameters(value);
  if (!params || params.length > 2) return null;
  const name = params[0];
  const context = params[1];
  const text = context ? adaptTemplateContext(value, context, typescript) : value.text();
  if (text === null) return null;
  const strings = new Set(name ? [name.text()] : []);
  if (context) for (const property of ["resource", "resourcePath", "resourceQuery", "resourceFragment", "context"]) strings.add(`${context.text()}.${property}`);
  const body = value.field("body");
  if (!body) return null;
  if (body.kind() !== "statement_block") return returnsString(body, strings) ? text : null;
  const statements = namedChildren(body).filter((node) => node.kind() !== "comment");
  const last = statements.pop();
  if (last?.kind() !== "return_statement") return null;
  for (const statement of statements) {
    const expression = statement.kind() === "expression_statement" ? namedChildren(statement)[0] : undefined;
    const callee = expression?.kind() === "call_expression" ? expression.field("function") : undefined;
    if (context && callee?.kind() === "member_expression" && callee.field("object")?.text() === context.text() && CONTEXT_METHODS.has(callee.field("property")?.text() ?? "")) continue;
    if (statement.kind() !== "lexical_declaration" || !statement.text().startsWith("const ")) return null;
    for (const declaration of namedChildren(statement).filter((node) => node.kind() !== "comment")) {
      const binding = declaration.field("name");
      if (binding?.kind() !== "identifier" || !returnsString(declaration.field("value"), strings)) return null;
      strings.add(binding.text());
    }
  }
  return returnsString(namedChildren(last).find((node) => node.kind() !== "comment") ?? null, strings) ? text : null;
}

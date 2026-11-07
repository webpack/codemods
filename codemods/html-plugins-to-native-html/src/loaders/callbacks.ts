import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { namedChildren } from "@webpack/codemod-utils";

export function callbackParameters(value: SgNode<Js>): SgNode<Js>[] | null {
  if (!["arrow_function", "function_expression"].some((kind) => value.is(kind))) return null;
  if (value.children().some((node) => node.is("async"))) return null;
  if (value.findAll({ rule: { any: [{ kind: "this" }, { pattern: "arguments" }] } }).length) return null;
  const parameters = value.field("parameters");
  const parameter = value.field("parameter");
  const params = parameters ? namedChildren(parameters).filter((node) => !node.is("comment")) : parameter ? [parameter] : [];
  if (params.some((param) => param.field("value") || param.is("assignment_pattern") || param.is("rest_pattern"))) return null;
  const names = params.map((param) => param.field("pattern") ?? param);
  return names.every((name) => name.is("identifier")) ? names : null;
}

export function isIdentityCallback(value: SgNode<Js>): boolean {
  const params = callbackParameters(value);
  if (!params?.length) return false;
  let body = value.field("body");
  if (body?.is("statement_block")) {
    const statements = namedChildren(body).filter((node) => !node.is("comment"));
    if (statements.length !== 1 || !statements[0].is("return_statement")) return false;
    body = namedChildren(statements[0]).find((node) => !node.is("comment")) ?? null;
  }
  return !!body?.is("identifier") && body.text() === params[0].text();
}

export function usesParameter(value: SgNode<Js>, params: SgNode<Js>[], index: number): boolean {
  const param = params[index];
  return !!param && !!value.field("body")?.findAll({ rule: { pattern: param.text() } }).length;
}

export function constantBoolean(value: SgNode<Js>): string | null {
  if (!callbackParameters(value)) return null;
  let body = value.field("body");
  if (body?.is("statement_block")) {
    const statements = namedChildren(body).filter((node) => !node.is("comment"));
    if (statements.length !== 1 || !statements[0].is("return_statement")) return null;
    body = namedChildren(statements[0])[0] ?? null;
  }
  return body?.is("true") || body?.is("false") ? body.text() : null;
}

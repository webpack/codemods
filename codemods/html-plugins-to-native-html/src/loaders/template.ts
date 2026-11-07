import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { namedChildren } from "@webpack/codemod-utils";
import { callbackParameters } from "./callbacks";

const STRING_METHODS = new Set([
  "concat",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "slice",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);

const CONTEXT_METHODS = new Map([
  ["addDependency", "(dependency: string) => void"],
  ["addContextDependency", "(dependency: string) => void"],
  ["addMissingDependency", "(dependency: string) => void"],
  ["addBuildDependency", "(dependency: string) => void"],
  ["emitWarning", "(warning: Error) => void"],
  ["emitError", "(error: Error) => void"],
]);

function adaptTemplateContext(
  value: SgNode<Js>,
  context: SgNode<Js>,
  typescript: boolean,
): string | null {
  const body = value.field("body")!;
  const edits = [];
  const properties = new Map<string, string>();
  const name = context.text();
  const resourcePattern = "/^((?:\\0.|[^?#\\0])*)(\\?(?:\\0.|[^#\\0])*)?(#.*)?$/";

  for (const reference of body
    .findAll({ rule: { kind: "identifier" } })
    .filter((node) => node.text() === name)) {
    const member = reference.parent();

    if (
      !member?.is("member_expression") ||
      member.field("object")?.range().start.index !== reference.range().start.index
    ) {
      return null;
    }

    const property = member.field("property")?.text();

    if (!property) {
      return null;
    }

    if (CONTEXT_METHODS.has(property)) {
      properties.set(property, CONTEXT_METHODS.get(property)!);
    } else if (property === "context") {
      properties.set("module", "{ context: string }");
      edits.push(member.replace(`${name}.module.context`));
    } else if (
      ["resource", "resourcePath", "resourceQuery", "resourceFragment"].includes(property)
    ) {
      properties.set("resource", "string");

      if (property === "resourcePath") {
        edits.push(
          member.replace(
            `${name}.resource.replace(${resourcePattern}, "$1").replace(/\\0(.)/g, "$1")`,
          ),
        );
      } else if (property === "resourceQuery") {
        edits.push(
          member.replace(
            `(${name}.resource.match(${resourcePattern})?.[2]?.replace(/\\0(.)/g, "$1") ?? "")`,
          ),
        );
      } else if (property === "resourceFragment") {
        edits.push(member.replace(`(${name}.resource.match(${resourcePattern})?.[3] ?? "")`));
      }
    } else {
      return null;
    }
  }

  if (typescript) {
    const parameter = namedChildren(value.field("parameters")!).filter(
      (node) => !node.is("comment"),
    )[1];
    const type = parameter.field("type");
    const text = `: { ${[...properties].map(([key, type]) => `${key}: ${type}`).join("; ")} }`;

    if (type) {
      edits.push(type.replace(text));
    } else {
      edits.push({
        startPos: context.range().end.index,
        endPos: context.range().end.index,
        insertedText: text,
      });
    }
  }

  return edits.length ? value.commitEdits(edits) : value.text();
}

function returnsString(node: SgNode<Js> | null, strings: Set<string>): boolean {
  if (!node) {
    return false;
  }

  if (node.is("string") || node.is("template_string")) {
    return true;
  }

  if (node.is("identifier") || node.is("member_expression")) {
    return strings.has(node.text());
  }

  if (node.is("parenthesized_expression")) {
    return returnsString(namedChildren(node)[0], strings);
  }

  if (node.is("binary_expression") && node.field("operator")?.text() === "+") {
    return (
      returnsString(node.field("left"), strings) || returnsString(node.field("right"), strings)
    );
  }

  if (node.is("ternary_expression")) {
    return (
      returnsString(node.field("consequence"), strings) &&
      returnsString(node.field("alternative"), strings)
    );
  }

  if (node.is("call_expression")) {
    const callee: SgNode<Js> = node.field("function");

    return (
      callee?.is("member_expression") &&
      STRING_METHODS.has(callee.field("property")?.text() ?? "") &&
      returnsString(callee.field("object"), strings)
    );
  }

  return false;
}

// Native templates must synchronously return a string. Limit automatic migration
// to inline string transforms whose result we can establish without executing
// user code. Unsupported context APIs and async/unknown returns need adaptation.
export function nativeTemplate(value: SgNode<Js>, typescript = false): string | null {
  if (!["arrow_function", "function_expression"].some((kind) => value.is(kind))) {
    return null;
  }

  if (value.children().some((node) => node.is("async"))) {
    return null;
  }

  if (
    value.findAll({
      rule: {
        any: [
          { kind: "await_expression" },
          { kind: "this" },
          { kind: "assignment_expression" },
          { kind: "augmented_assignment_expression" },
          { kind: "update_expression" },
          { pattern: "arguments" },
        ],
      },
    }).length
  ) {
    return null;
  }

  const params = callbackParameters(value);

  if (!params || params.length > 2) {
    return null;
  }

  const name = params[0];
  const context = params[1];
  const text = context ? adaptTemplateContext(value, context, typescript) : value.text();

  if (text === null) {
    return null;
  }

  const strings = new Set(name ? [name.text()] : []);

  if (context) {
    for (const property of [
      "resource",
      "resourcePath",
      "resourceQuery",
      "resourceFragment",
      "context",
    ]) {
      strings.add(`${context.text()}.${property}`);
    }
  }

  const body = value.field("body");

  if (!body) {
    return null;
  }

  if (!body.is("statement_block")) {
    return returnsString(body, strings) ? text : null;
  }

  const statements = namedChildren(body).filter((node) => !node.is("comment"));
  const last = statements.pop();

  if (!last?.is("return_statement")) {
    return null;
  }

  for (const statement of statements) {
    const expression = statement.is("expression_statement")
      ? namedChildren(statement)[0]
      : undefined;
    const callee: SgNode<Js> | undefined = expression?.is("call_expression")
      ? expression.field("function")
      : undefined;

    if (
      context &&
      callee?.is("member_expression") &&
      callee.field("object")?.text() === context.text() &&
      CONTEXT_METHODS.has(callee.field("property")?.text() ?? "")
    ) {
      continue;
    }

    if (!statement.is("lexical_declaration") || !statement.text().startsWith("const ")) {
      return null;
    }

    for (const declaration of namedChildren(statement).filter((node) => !node.is("comment"))) {
      const binding = declaration.field("name");

      if (!binding?.is("identifier") || !returnsString(declaration.field("value"), strings)) {
        return null;
      }

      strings.add(binding.text());
    }
  }

  return returnsString(namedChildren(last).find((node) => !node.is("comment")) ?? null, strings)
    ? text
    : null;
}

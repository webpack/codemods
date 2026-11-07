import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { parse } from "codemod:ast-grep";

import { namedChildren } from "./ast";

function decodeEscape(text: string): string | null {
  const escaped = text.slice(1);
  const simple: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    "\n": "",
    "\r": "",
    "\r\n": "",
  };

  if (Object.hasOwn(simple, escaped)) {
    return simple[escaped];
  }

  if (/^[0-7]{1,3}$/.test(escaped)) {
    return String.fromCharCode(Number.parseInt(escaped, 8));
  }

  if (/^x[\da-f]{2}$/i.test(escaped)) {
    return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
  }

  if (/^u[\da-f]{4}$/i.test(escaped)) {
    return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
  }

  if (/^u\{[\da-f]+\}$/i.test(escaped)) {
    const codePoint = Number.parseInt(escaped.slice(2, -1), 16);

    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : null;
  }

  return escaped.length === 1 ? escaped : null;
}

// Read literal values from syntax nodes without evaluating user code.
// Escape decoding operates on individual escape tokens, not source patterns.
export function staticString(node: SgNode<Js> | null | undefined): string | null {
  if (!node) {
    return null;
  }

  if (node.is("parenthesized_expression")) {
    return staticString(namedChildren(node).find((child) => !child.is("comment")));
  }

  if (node.is("binary_expression") && node.field("operator")?.is("+")) {
    const left = staticString(node.field("left"));
    const right = staticString(node.field("right"));

    return left === null || right === null ? null : left + right;
  }

  if (!node.is("string") && !node.is("template_string")) {
    return null;
  }

  let result = "";

  for (const child of namedChildren(node)) {
    if (child.is("string_fragment")) {
      result += child.text();
    } else if (child.is("escape_sequence")) {
      const value = decodeEscape(child.text());

      if (value === null) {
        return null;
      }

      result += value;
    } else {
      return null;
    }
  }

  return result;
}

function unwrapParentheses(node: SgNode<Js>): SgNode<Js> {
  while (node.is("parenthesized_expression")) {
    const inner = namedChildren(node).find((child) => !child.is("comment"));

    if (!inner) {
      break;
    }

    node = inner;
  }

  return node;
}

// Compare syntax while ignoring trivia and redundant parentheses. Operators,
// property order, optional chaining, and other executable tokens still matter.
export function sameSyntax(left: SgNode<Js>, right: SgNode<Js>): boolean {
  left = unwrapParentheses(left);
  right = unwrapParentheses(right);

  if (!left.is(right.kind())) {
    return false;
  }

  if (left.is("string")) {
    const value = staticString(left);

    if (value !== null) {
      return value === staticString(right);
    }
  }

  const leftChildren = left.children().filter((node) => !node.is("comment"));
  const rightChildren = right.children().filter((node) => !node.is("comment"));

  if (!leftChildren.length && !rightChildren.length) {
    return left.text() === right.text();
  }

  return (
    leftChildren.length === rightChildren.length &&
    leftChildren.every((node, index) => sameSyntax(node, rightChildren[index]))
  );
}

export function parseExpression(source: string): SgNode<Js> {
  const root = parse<Js>("typescript", `(${source})`);
  const statement = namedChildren(root.root())[0];

  return unwrapParentheses(namedChildren(statement)[0]);
}

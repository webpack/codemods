import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";

export interface Range {
  start: number;
  end: number;
}

export function rangeOf(node: SgNode<Js>): Range {
  const range = node.range();
  return { start: range.start.index, end: range.end.index };
}

export function unquote(text: string): string {
  return text.replace(/^["'`]/, "").replace(/["'`]$/, "");
}

export function namedChildren(node: SgNode<Js>): SgNode<Js>[] {
  return node.children().filter((child) => child.isNamed());
}

export function keyName(pair: SgNode<Js>): string | null {
  const key = pair.field("key");
  return key ? unquote(key.text()) : null;
}

export function pairsOf(objectNode: SgNode<Js>): SgNode<Js>[] {
  return namedChildren(objectNode).filter((child) => child.kind() === "pair");
}

export function findPair(objectNode: SgNode<Js>, name: string): SgNode<Js> | undefined {
  return pairsOf(objectNode).find((pair) => keyName(pair) === name);
}

// Whitespace at the start of the line containing `index`.
export function lineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : "";
}

export function isInsideAny(range: Range, ranges: Range[]): boolean {
  return ranges.some((outer) => range.start >= outer.start && range.end <= outer.end);
}

// `[ ... ].filter(<any predicate>)` — return the inner array literal.
export function unwrapFilterCall(node: SgNode<Js>): SgNode<Js> {
  if (node.kind() !== "call_expression") return node;
  const callee = node.field("function");
  if (!callee || callee.kind() !== "member_expression") return node;
  if (callee.field("property")?.text() !== "filter") return node;
  const receiver = callee.field("object");
  return receiver && receiver.kind() === "array" ? receiver : node;
}

// The `.filter(...)` text that followed the array, e.g. `.filter((x) => !!x)`.
export function filterSuffixOf(originalValue: SgNode<Js>, arrayNode: SgNode<Js>): string {
  if (originalValue.range().start.index === arrayNode.range().start.index) {
    return originalValue.text().slice(arrayNode.text().length);
  }
  return "";
}

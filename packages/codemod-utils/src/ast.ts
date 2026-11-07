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

export function namedChildren(node: SgNode<Js>): SgNode<Js>[] {
  return node.children().filter((child) => child.isNamed());
}

export function keyName(pair: SgNode<Js>): string | null {
  const key = pair.field("key");

  if (!key) return null;

  const text = key.text();
  if (!text) return null;

  const first = text[0];
  const last = text[text.length - 1];
  if (text.length >= 2 && first === last && (first === '"' || first === "'" || first === "`")) {
    return text.slice(1, -1);
  }

  return text;
}

export function pairsOf(objectNode: SgNode<Js>): SgNode<Js>[] {
  return namedChildren(objectNode).filter((child) => child.is("pair"));
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

// Effective branches behind a dev/prod guard (`cond && x`, `cond ? a : b`),
// or null when the node is not a guard.
export function guardBranchesOf(node: SgNode<Js>): SgNode<Js>[] | null {
  if (node.is("binary_expression") && node.field("operator")?.text() === "&&") {
    const right = node.field("right");
    return right ? [right] : [];
  }
  if (node.is("ternary_expression")) {
    const branches = [node.field("consequence"), node.field("alternative")];
    return branches.filter((branch) => branch !== null);
  }
  return null;
}

// Climb while the removal would leave an empty container behind, so chains
// like a css-only `oneOf` → rule → `rules` → `module` collapse as one removal.
// Stops where a container keeps other members or is not a property/element.
export function cascadeRemovalTarget(node: SgNode<Js>): SgNode<Js> {
  let target = node;
  for (;;) {
    const parent = target.parent();
    if (!parent) return target;
    if (parent.is("pair")) {
      target = parent;
      continue;
    }
    if (!parent.is("object") && !parent.is("array")) return target;
    const members = parent.is("object") ? pairsOf(parent) : namedChildren(parent);
    if (members.length !== 1) return target;
    const grandparent = parent.parent();
    if (!grandparent || (!grandparent.is("pair") && !grandparent.is("array"))) {
      return target;
    }
    target = parent;
  }
}

// `[ ... ].filter(<predicate>)` — return the inner array literal.
export function unwrapFilterCall(node: SgNode<Js>): SgNode<Js> {
  if (!node.is("call_expression")) return node;
  const callee = namedChildren(node)[0] as SgNode<Js> | undefined;
  if (!callee || !callee.is("member_expression")) return node;
  const parts = namedChildren(callee);
  if (parts.length !== 2 || parts[1].text() !== "filter") return node;
  const receiver = parts[0];
  return receiver && receiver.is("array") ? receiver : node;
}

// The `.filter(...)` text that followed the array, e.g. `.filter((x) => !!x)`.
export function filterSuffixOf(originalValue: SgNode<Js>, arrayNode: SgNode<Js>): string {
  if (originalValue.range().start.index === arrayNode.range().start.index) {
    return originalValue.text().slice(arrayNode.text().length);
  }
  return "";
}

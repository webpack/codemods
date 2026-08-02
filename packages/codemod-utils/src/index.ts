import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { Edit, SgNode } from "@codemod.com/jssg-types/main";

import {
  type Range,
  findPair,
  isInsideAny,
  keyName,
  lineIndent,
  namedChildren,
  rangeOf,
  unquote,
} from "./ast";
import type { ModuleBinding } from "./imports";

export * from "./ast";
export * from "./imports";

// ---------- webpack config helpers ----------

// Loader name behind a `use` entry: a plain string, `require.resolve("...")`,
// or `{ loader: <one of those> }`.
export function loaderNameOf(node: SgNode<Js>): string | null {
  if (node.kind() === "string") return unquote(node.text());
  if (node.kind() === "call_expression") {
    const resolved = /^require\.resolve\(\s*(["'`][^"'`]+["'`])\s*\)$/.exec(node.text());
    return resolved ? unquote(resolved[1]) : null;
  }
  if (node.kind() !== "object") return null;
  const loaderValue = findPair(node, "loader")?.field("value");
  return loaderValue ? loaderNameOf(loaderValue) : null;
}

// Whether the rule claims one of the sample resource paths — used to know if it
// disables an `experiments.*: "auto"` default. Unreadable conditions count as
// matching, to be safe.
export function ruleMatchesFiles(ruleObject: SgNode<Js>, sampleFiles: string[]): boolean {
  const testValue = findPair(ruleObject, "test")?.field("value");
  if (!testValue) return true;
  if (testValue.kind() !== "regex") return true;
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(testValue.text());
  if (!literal) return true;
  try {
    const regex = new RegExp(literal[1], literal[2]);
    return sampleFiles.some((file) => regex.test(file));
  } catch {
    return true;
  }
}

// The enclosing webpack config object: nearest ancestor holding a `module` pair.
export function findConfigObjectFor(node: SgNode<Js>): SgNode<Js> | null {
  let current = node.parent();
  while (current) {
    if (current.kind() === "pair" && keyName(current) === "module") {
      const parent = current.parent();
      if (parent && parent.kind() === "object") return parent;
    }
    current = current.parent();
  }
  return null;
}

// ---------- edit collection ----------

// Accumulates edits over one config file: text removals grouped per parent
// container (so sibling removals never overlap), brace-aware property
// insertion, and unused-import cleanup.
export class ConfigEditor {
  readonly rootNode: SgNode<Js>;
  readonly source: string;

  private readonly edits: Edit[] = [];
  private readonly editedRanges: Range[] = [];
  private readonly pendingRemovals = new Map<
    number,
    { parent: SgNode<Js>; removed: Set<number> }
  >();
  // Fully-emptied objects that must keep their braces open for new properties.
  private readonly keepOpenTargets = new Set<number>();

  // Line ending of the source file; generated text must use it too.
  readonly eol: string;

  constructor(rootNode: SgNode<Js>) {
    this.rootNode = rootNode;
    this.source = rootNode.text();
    this.eol = this.source.includes("\r\n") ? "\r\n" : "\n";
  }

  get hasEdits(): boolean {
    return this.edits.length > 0;
  }

  // Generated text may mix "\n" with source fragments that already carry the
  // file's EOL — normalize first so the conversion never doubles a "\r".
  private toSourceEol(text: string): string {
    return text.split("\r\n").join("\n").split("\n").join(this.eol);
  }

  replace(node: SgNode<Js>, text: string): void {
    this.edits.push(node.replace(this.toSourceEol(text)));
    this.editedRanges.push(rangeOf(node));
  }

  removeText(range: Range): void {
    this.edits.push({ startPos: range.start, endPos: range.end, insertedText: "" });
    this.editedRanges.push(range);
  }

  markForRemoval(node: SgNode<Js>): void {
    const parent = node.parent();
    if (!parent) return;
    const key = parent.range().start.index;
    let group = this.pendingRemovals.get(key);
    if (!group) {
      group = { parent, removed: new Set() };
      this.pendingRemovals.set(key, group);
    }
    group.removed.add(node.range().start.index);
  }

  keepBracesOpen(objectNode: SgNode<Js>): void {
    this.keepOpenTargets.add(objectNode.range().start.index);
  }

  finalizeRemovals(): void {
    for (const { parent, removed } of this.pendingRemovals.values()) {
      const children = namedChildren(parent);
      if (children.every((child) => removed.has(child.range().start.index))) {
        this.clearContainer(parent, children);
        continue;
      }
      this.removeChildRuns(children, removed);
    }
  }

  // Insert properties right after an object's opening brace, matching its layout.
  insertIntoObject(
    objectNode: SgNode<Js>,
    buildProperties: (indent: string, indentUnit: string) => string[],
  ): void {
    const insertAt = objectNode.range().start.index + 1;
    const properties = namedChildren(objectNode);
    const multiline = objectNode.text().includes("\n") && properties.length > 0;
    let insertedText: string;
    if (multiline) {
      const indent = lineIndent(this.source, properties[0].range().start.index);
      const indentUnit = indent.includes("\t") ? "\t" : indent || "  ";
      insertedText = buildProperties(indent, indentUnit)
        .map((property) => `\n${indent}${property},`)
        .join("");
    } else if (properties.length) {
      insertedText = ` ${buildProperties("", "").join(", ")},`;
    } else {
      insertedText = ` ${buildProperties("", "").join(", ")} `;
    }
    this.edits.push({
      startPos: insertAt,
      endPos: insertAt,
      insertedText: this.toSourceEol(insertedText),
    });
  }

  // Drop the binding's statement once no reference survives outside the edited
  // ranges. Call after finalizeRemovals so those ranges are complete.
  removeBindingIfUnused(binding: ModuleBinding): void {
    const statementRange = rangeOf(binding.statement);
    const survivingReference = this.rootNode
      .findAll({ rule: { kind: "identifier" } })
      .some((identifier) => {
        if (identifier.text() !== binding.name) return false;
        const range = rangeOf(identifier);
        if (range.start >= statementRange.start && range.end <= statementRange.end) return false;
        return !isInsideAny(range, this.editedRanges);
      });
    if (survivingReference) return;
    let end = statementRange.end;
    if (this.source[end] === "\r") end += 1;
    if (this.source[end] === "\n") end += 1;
    // At the top of the file also swallow the blank line that separated it.
    while (
      statementRange.start === 0 &&
      (this.source[end] === "\n" || this.source[end] === "\r")
    ) {
      end += 1;
    }
    this.edits.push({ startPos: statementRange.start, endPos: end, insertedText: "" });
  }

  commit(): string {
    return this.rootNode.commitEdits(this.edits);
  }

  private clearContainer(parent: SgNode<Js>, children: SgNode<Js>[]): void {
    if (this.keepOpenTargets.has(parent.range().start.index) && children.length) {
      // New properties will be inserted after "{" — clear the content only.
      const first = children[0].range().start.index;
      const lineStart = this.source.lastIndexOf("\n", first - 1) + 1;
      this.removeText({
        start: lineStart > parent.range().start.index ? lineStart : first,
        end: parent.range().end.index - 1,
      });
    } else {
      this.edits.push(parent.replace(parent.kind() === "array" ? "[]" : "{}"));
      this.editedRanges.push(rangeOf(parent));
    }
  }

  // Delete each contiguous run of removed children up to the next kept
  // sibling, or back to the previous kept one for a trailing run.
  private removeChildRuns(children: SgNode<Js>[], removed: Set<number>): void {
    let index = 0;
    while (index < children.length) {
      if (!removed.has(children[index].range().start.index)) {
        index += 1;
        continue;
      }
      let runEnd = index;
      while (
        runEnd + 1 < children.length &&
        removed.has(children[runEnd + 1].range().start.index)
      ) {
        runEnd += 1;
      }
      const next = children[runEnd + 1];
      if (next) {
        this.removeText({
          start: children[index].range().start.index,
          end: next.range().start.index,
        });
      } else {
        this.removeText({
          start: children[index - 1].range().end.index,
          end: children[runEnd].range().end.index,
        });
      }
      index = runEnd + 1;
    }
  }
}

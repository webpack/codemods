import type Html from "@codemod.com/jssg-types/langs/html";
import type { Edit, SgRoot } from "@codemod.com/jssg-types/main";
import { normalizeFilename, scriptsForTemplate, type TemplateScript } from "./migration-state";

function attributeValue(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function chunkComment(name: string): string {
  // JSON escapes are understood by webpack's magic-comment parser. Escape
  // HTML delimiters too so an entry name cannot terminate the comment.
  const escaped = JSON.stringify(name).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/-/g, "\\u002d");
  return `<!-- webpackChunkName: ${escaped} -->`;
}

export function templateScriptTag(script: TemplateScript): string {
  return `${script.chunkName ? `${chunkComment(script.chunkName)} ` : ""}<script defer src="${attributeValue(script.src)}"></script>`;
}

export function addTemplateScripts(root: SgRoot<Html>, scripts: TemplateScript[]): string | null {
  if (!scripts.length) return null;
  const node = root.root();
  const source = node.text();
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const edits: Edit[] = [];
  const requested = new Map<string, TemplateScript>();
  const names = new Map<string, Set<string | undefined>>();
  for (const script of scripts) {
    const key = normalizeFilename(attributeValue(script.src));
    const chunkNames = names.get(key) ?? new Set();
    chunkNames.add(script.chunkName);
    names.set(key, chunkNames);
    // Shared templates may be requested by configs with different entry names.
    // Keep webpack's default naming when there is no unambiguous choice.
    requested.set(key, { src: script.src, chunkName: chunkNames.size === 1 ? script.chunkName : undefined });
  }
  const existing = new Set<string>();
  for (const script of node.findAll({ rule: { kind: "script_element" } })) {
    const start = script.children().find((child) => child.kind() === "start_tag");
    for (const attribute of start?.children() ?? []) {
      if (attribute.kind() !== "attribute") continue;
      const name = attribute.children().find((child) => child.kind() === "attribute_name");
      if (name?.text().toLowerCase() !== "src") continue;
      const value = attribute.children().find((child) => child.kind() === "quoted_attribute_value" || child.kind() === "attribute_value");
      if (!value) continue;
      const key = normalizeFilename(value.text().replace(/^["']|["']$/g, ""));
      existing.add(key);
      const chunkName = requested.get(key)?.chunkName;
      const previous = script.prev();
      // A new comment would override existing webpackIgnore/Preload/etc.
      if (!chunkName || (previous?.kind() === "comment" && /\bwebpack\w+\s*:/.test(previous.text()))) continue;
      const position = script.range().start.index;
      const indent = source.slice(source.lastIndexOf("\n", position - 1) + 1, position);
      const separator = /^[ \t]*$/.test(indent) ? `${eol}${indent}` : " ";
      edits.push({ startPos: position, endPos: position, insertedText: `${chunkComment(chunkName)}${separator}` });
    }
  }
  const missing = [...requested].filter(([key]) => !existing.has(key)).map(([, script]) => script);
  if (!missing.length) return edits.length ? node.commitEdits(edits) : null;
  const tags = missing.map(templateScriptTag);
  const endings = node.findAll({ rule: { kind: "end_tag" } });
  const closing = endings.find((tag) => /^<\/head\s*>$/i.test(tag.text()))
    ?? endings.find((tag) => /^<\/body\s*>$/i.test(tag.text()));
  let position = source.length;
  let text = `${source.endsWith("\n") || !source ? "" : eol}${tags.join(eol)}${eol}`;
  if (closing) {
    position = closing.range().start.index;
    const lineStart = source.lastIndexOf("\n", position - 1) + 1;
    const indent = source.slice(lineStart, position);
    if (/^[ \t]*$/.test(indent)) {
      position = lineStart;
      text = tags.map((tag) => `${indent}  ${tag}${eol}`).join("");
    } else {
      text = tags.join("");
    }
  }
  edits.push({ startPos: position, endPos: position, insertedText: text });
  return node.commitEdits(edits);
}

export default async function transform(root: SgRoot<Html>): Promise<string | null> {
  return addTemplateScripts(root, scriptsForTemplate(root.filename()));
}

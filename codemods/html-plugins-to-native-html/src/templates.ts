import type Html from "@codemod.com/jssg-types/langs/html";
import type { SgRoot } from "@codemod.com/jssg-types/main";
import { normalizeFilename, scriptsForTemplate } from "./migration-state";

function attributeValue(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function addTemplateScripts(root: SgRoot<Html>, scripts: string[]): string | null {
  if (!scripts.length) return null;
  const node = root.root();
  const source = node.text();
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const existing = new Set<string>();
  for (const script of node.findAll({ rule: { kind: "script_element" } })) {
    const start = script.children().find((child) => child.kind() === "start_tag");
    for (const attribute of start?.children() ?? []) {
      if (attribute.kind() !== "attribute") continue;
      const name = attribute.children().find((child) => child.kind() === "attribute_name");
      if (name?.text().toLowerCase() !== "src") continue;
      const value = attribute.children().find((child) => child.kind() === "quoted_attribute_value" || child.kind() === "attribute_value");
      if (value) existing.add(normalizeFilename(value.text().replace(/^["']|["']$/g, "")));
    }
  }
  const missing = [...new Set(scripts)].filter((script) => !existing.has(normalizeFilename(attributeValue(script))));
  if (!missing.length) return null;
  const tags = missing.map((script) => `<script defer src="${attributeValue(script)}"></script>`);
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
  return node.commitEdits([{ startPos: position, endPos: position, insertedText: text }]);
}

export default async function transform(root: SgRoot<Html>): Promise<string | null> {
  return addTemplateScripts(root, scriptsForTemplate(root.filename()));
}

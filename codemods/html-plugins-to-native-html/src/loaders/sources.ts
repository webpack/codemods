import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, keyName, namedChildren, unquote } from "@webpack/codemod-utils";
import { callbackParameters, constantBoolean, usesParameter } from "./callbacks";

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
  if (value.is("true") || value.is("false")) return { text: value.text(), extendsDefaults: false };
  if (!value.is("object")) return null;
  const options = namedChildren(value).filter((node) => !node.is("comment"));
  if (!options.length) return { text: "true", extendsDefaults: false };
  const keys = options.map(keyName);
  if (new Set(keys).size !== keys.length || keys.some((key) => !key || !["list", "urlFilter", "scriptingEnabled"].includes(key))) return null;
  const scripting = findPair(value, "scriptingEnabled")?.field("value");
  if (scripting && !scripting.is("true")) return null;
  const urlFilter = findPair(value, "urlFilter")?.field("value");
  const urlConstant = urlFilter ? constantBoolean(urlFilter) : "true";
  if (urlConstant === "false") return { text: "false", extendsDefaults: false };
  const list = findPair(value, "list")?.field("value");
  if (!list) return urlConstant === "true" ? { text: "true", extendsDefaults: false } : null;
  if (!list.is("array")) return null;
  const urlParams = urlFilter ? callbackParameters(urlFilter) : [];
  if (urlConstant === null && (!urlParams || urlParams.length > 3 || usesParameter(urlFilter!, urlParams, 2))) return null;
  const edits = [];
  for (const source of namedChildren(list)) {
    if (source.is("comment")) continue;
    if (source.is("string") && unquote(source.text()) === "...") {
      if (urlConstant === null) return null;
      continue;
    }
    if (!source.is("object")) return null;
    const properties = namedChildren(source).filter((node) => !node.is("comment"));
    const names = properties.map(keyName);
    if (new Set(names).size !== names.length) return null;
    if (!findPair(source, "attribute") || !findPair(source, "type")) return null;
    for (const property of properties) {
      const name = keyName(property);
      const option = property.field("value");
      if (!name || !["tag", "attribute", "type", "filter"].includes(name) || !option) return null;
      if (name === "filter") continue;
      if (name === "type") {
        if (!option.is("string") || !["src", "srcset"].includes(unquote(option.text()))) return null;
      } else if (!option.is("string")) return null;
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
    extendsDefaults: namedChildren(list).some((node) => node.is("string") && unquote(node.text()) === "..."),
  };
}

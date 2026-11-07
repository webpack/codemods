import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, keyName, namedChildren, unquote } from "@webpack/codemod-utils";

// The native parser accepts the list directly. Loader callbacks have different
// signatures, so retain rules with filters, functions, spreads or dynamic lists.
export function nativeSources(value: SgNode<Js>): string | null {
  if (value.kind() === "true" || value.kind() === "false") return value.text();
  if (value.kind() !== "object") return null;
  const options = namedChildren(value).filter((node) => node.kind() !== "comment");
  if (!options.length) return "true";
  if (options.length !== 1 || keyName(options[0]) !== "list") return null;
  const list = options[0].field("value");
  if (list?.kind() !== "array") return null;
  for (const source of namedChildren(list)) {
    if (source.kind() === "comment") continue;
    if (source.kind() === "string" && unquote(source.text()) === "...") continue;
    if (source.kind() !== "object") return null;
    const properties = namedChildren(source).filter((node) => node.kind() !== "comment");
    const names = properties.map(keyName);
    if (new Set(names).size !== names.length) return null;
    if (!findPair(source, "attribute") || !findPair(source, "type")) return null;
    for (const property of properties) {
      const name = keyName(property);
      const option = property.field("value");
      if (!name || !["tag", "attribute", "type"].includes(name) || !option) return null;
      if (name === "type") {
        if (option.kind() !== "string" || !["src", "srcset"].includes(unquote(option.text()))) return null;
      } else if (option.kind() !== "string") return null;
    }
  }
  return list.text();
}

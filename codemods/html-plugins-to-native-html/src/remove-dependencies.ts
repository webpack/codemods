import type Js from "@codemod.com/jssg-types/langs/javascript";
import type Json from "@codemod.com/jssg-types/langs/json";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import { ConfigEditor, findPair, keyName, namedChildren, pairsOf } from "@webpack/codemod-utils";

import { HTML_PACKAGES, remainingPackages } from "./migration-state";

const REMOVED_PACKAGES = new Set(HTML_PACKAGES);
const DEPENDENCY_KEYS = ["dependencies", "devDependencies"];

export function removeUnusedDependencies(root: SgRoot<Json>, remaining: Set<string> | null): string | null {
  // JSON shares the object/pair/string node kinds the editor operates on.
  const rootNode = root.root() as unknown as SgNode<Js>;
  const editor = new ConfigEditor(rootNode);
  const manifest = namedChildren(rootNode)[0];
  if (!manifest || !manifest.is("object")) return null;
  if (!remaining) return null;
  // Scripts and other manifest fields can invoke these packages as well.
  for (const pair of pairsOf(manifest)) {
    if (DEPENDENCY_KEYS.includes(keyName(pair) ?? "")) continue;
    for (const name of REMOVED_PACKAGES) {
      if (pair.text().includes(name)) remaining.add(name);
    }
  }
  for (const key of DEPENDENCY_KEYS) {
    const value = findPair(manifest, key)?.field("value");
    if (!value || !value.is("object")) continue;
    for (const pair of pairsOf(value)) {
      const name = keyName(pair);
      if (name && REMOVED_PACKAGES.has(name) && !remaining.has(name)) editor.markForRemoval(pair);
    }
  }
  editor.finalizeRemovals();
  if (!editor.hasEdits) return null;
  return editor.commit();
}

export default async function transform(root: SgRoot<Json>): Promise<string | null> {
  return removeUnusedDependencies(root, remainingPackages(root.filename()));
}

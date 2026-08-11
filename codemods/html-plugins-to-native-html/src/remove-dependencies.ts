import type Js from "@codemod.com/jssg-types/langs/javascript";
import type Json from "@codemod.com/jssg-types/langs/json";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import { ConfigEditor, findPair, keyName, namedChildren, pairsOf } from "@webpack/codemod-utils";

// Packages replaced by native HTML; review your lockfile if other tooling
// (Storybook, tests, …) still relies on them.
const REMOVED_PACKAGES = new Set([
  "html-webpack-plugin",
  "html-loader",
  "csp-html-webpack-plugin",
  "webpack-subresource-integrity",
  "favicons-webpack-plugin",
]);
const DEPENDENCY_KEYS = ["dependencies", "devDependencies"];

async function transform(root: SgRoot<Json>): Promise<string | null> {
  // JSON shares the object/pair/string node kinds the editor operates on.
  const rootNode = root.root() as unknown as SgNode<Js>;
  const editor = new ConfigEditor(rootNode);
  const manifest = namedChildren(rootNode)[0];
  if (!manifest || manifest.kind() !== "object") return null;
  for (const key of DEPENDENCY_KEYS) {
    const value = findPair(manifest, key)?.field("value");
    if (!value || value.kind() !== "object") continue;
    for (const pair of pairsOf(value)) {
      const name = keyName(pair);
      if (name && REMOVED_PACKAGES.has(name)) editor.markForRemoval(pair);
    }
  }
  editor.finalizeRemovals();
  if (!editor.hasEdits) return null;
  return editor.commit();
}

export default transform;

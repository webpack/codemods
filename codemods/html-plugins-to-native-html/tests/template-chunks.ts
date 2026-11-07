import type Html from "@codemod.com/jssg-types/langs/html";
import type { SgRoot } from "@codemod.com/jssg-types/main";
import { addTemplateScripts } from "../src/templates";

export default async function transform(root: SgRoot<Html>): Promise<string | null> {
  if (root.filename().includes("conflicting")) {
    return addTemplateScripts(root, [{ src: "./index.js", chunkName: "app" }, { src: "./index.js", chunkName: "admin" }]);
  }
  const chunkName = root.filename().includes("escaped") ? 'app--><script>"' : "app";
  return addTemplateScripts(root, [{ src: "./index.js", chunkName }]);
}

import type Html from "@codemod.com/jssg-types/langs/html";
import type { SgRoot } from "@codemod.com/jssg-types/main";
import { addTemplateScripts } from "../src/templates";

export default async function transform(root: SgRoot<Html>): Promise<string | null> {
  return addTemplateScripts(root, [{ src: "./index.js" }]);
}

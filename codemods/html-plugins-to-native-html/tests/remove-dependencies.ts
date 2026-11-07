import type Json from "@codemod.com/jssg-types/langs/json";
import type { SgRoot } from "@codemod.com/jssg-types/main";
import { removeUnusedDependencies } from "../src/remove-dependencies";

// Unit fixtures describe packages with no remaining source references.
// Workflow integration tests cover collection and retention across files.
export default async function transform(root: SgRoot<Json>): Promise<string | null> {
  return removeUnusedDependencies(root, new Set());
}

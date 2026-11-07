import type Json from "@codemod.com/jssg-types/langs/json";
import type { SgRoot } from "@codemod.com/jssg-types/main";
import { removeUnusedDependencies } from "../src/remove-dependencies";

// Simulate absent, partial, and completed reference scans. The workflow
// integration tests cover collecting those references across source files.
export default async function transform(root: SgRoot<Json>): Promise<string | null> {
  if (root.filename().includes("missing-scan")) return removeUnusedDependencies(root, null);
  const remaining = root.filename().includes("source-reference") ? new Set(["html-loader"]) : new Set<string>();
  return removeUnusedDependencies(root, remaining);
}

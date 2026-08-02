// The utils package is internal and never published: when its source changes,
// the codemods that bundle it must be re-released. Fail the PR unless at least
// one dependent codemod is covered by a pending changeset.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "origin/main";
const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

if (!changed.some((file) => file.startsWith("packages/codemod-utils/src/"))) {
  process.exit(0);
}

const dependents = [];
for (const entry of readdirSync("codemods", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packagePath = join("codemods", entry.name, "package.json");
  if (!existsSync(packagePath)) continue;
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (pkg.dependencies?.["@webpack/codemod-utils"]) dependents.push(pkg.name);
}
if (!dependents.length) process.exit(0);

const covered = new Set();
for (const file of readdirSync(".changeset")) {
  if (!file.endsWith(".md") || file === "README.md") continue;
  const content = readFileSync(join(".changeset", file), "utf8");
  for (const name of dependents) {
    if (content.includes(`"${name}"`)) covered.add(name);
  }
}
if (covered.size) process.exit(0);

console.error(
  "packages/codemod-utils changed, but no changeset bumps a dependent codemod.\n" +
    "The utils are bundled into the published codemods, so add a changeset for the affected ones:\n" +
    dependents.map((name) => `  - ${name}`).join("\n"),
);
process.exit(1);

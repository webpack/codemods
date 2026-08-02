// Internal packages under packages/ are never published: when their source
// changes, the codemods that bundle them must be re-released. Fail the PR
// unless at least one dependent codemod is covered by a pending changeset.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function readPackageName(dir, entry) {
  const packagePath = join(dir, entry, "package.json");
  if (!existsSync(packagePath)) return null;
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

const base = process.argv[2] ?? "origin/main";
const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const touchedInternal = [];
for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = readPackageName("packages", entry.name);
  if (!pkg) continue;
  if (changed.some((file) => file.startsWith(`packages/${entry.name}/src/`))) {
    touchedInternal.push(pkg.name);
  }
}
if (!touchedInternal.length) process.exit(0);

const dependents = [];
for (const entry of readdirSync("codemods", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = readPackageName("codemods", entry.name);
  if (!pkg) continue;
  if (touchedInternal.some((name) => pkg.dependencies?.[name])) dependents.push(pkg.name);
}
if (!dependents.length) process.exit(0);

const covered = readdirSync(".changeset")
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .some((file) => {
    const content = readFileSync(join(".changeset", file), "utf8");
    return dependents.some((name) => content.includes(`"${name}"`));
  });
if (covered) process.exit(0);

console.error(
  `${touchedInternal.join(", ")} changed, but no changeset bumps a dependent codemod.\n` +
    "Internal packages are bundled into the published codemods, so add a changeset for the affected ones:\n" +
    dependents.map((name) => `  - ${name}`).join("\n"),
);
process.exit(1);

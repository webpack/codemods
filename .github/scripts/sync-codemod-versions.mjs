// Keeps each codemod.yaml `version` in sync with the package.json version
// bumped by `changeset version`. Run as part of the root `version` script.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const codemodsDir = "codemods";
for (const entry of readdirSync(codemodsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packagePath = join(codemodsDir, entry.name, "package.json");
  const manifestPath = join(codemodsDir, entry.name, "codemod.yaml");
  if (!existsSync(packagePath) || !existsSync(manifestPath)) continue;
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const manifest = readFileSync(manifestPath, "utf8");
  const updated = manifest.replace(/^version: .*$/m, `version: "${version}"`);
  if (updated !== manifest) {
    writeFileSync(manifestPath, updated);
    console.log(`${manifestPath} -> ${version}`);
  }
}

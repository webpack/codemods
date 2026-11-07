import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const fixture = path.join(workspace, "tests/integration/project");
const files = readdirSync(fixture, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(fixture, path.join(entry.parentPath, entry.name)));

function runWorkflow(target, dryRun = false) {
  assert.ok(process.env.npm_execpath, "Run this test through npm run test:integration");
  execFileSync(process.execPath, [
    process.env.npm_execpath, "exec", "--", "codemod", "workflow", "run",
    "--workflow", path.join(workspace, "workflow.yaml"), "--target", target,
    "--allow-dirty", "--no-interactive", "--disable-analytics",
    ...(dryRun ? ["--dry-run"] : []),
  ], { cwd: workspace, encoding: "utf8", timeout: 120_000, stdio: "pipe" });
}

test("workflow applies HTML and dependency edits through the runner, without fs permission", () => {
  const target = mkdtempSync(path.join(tmpdir(), "webpack-html-workflow-"));
  try {
    cpSync(fixture, target, { recursive: true });
    execFileSync("git", ["init", "--quiet", target]);
    runWorkflow(target, true);
    for (const file of files) {
      assert.deepEqual(readFileSync(path.join(target, file)), readFileSync(path.join(fixture, file)),
        `dry run modified ${file}`);
    }

    runWorkflow(target);
    const html = readFileSync(path.join(target, "src/index.html"), "utf8");
    assert.match(html, /<!-- webpackChunkName: "main" -->/);
    const namedHtml = readFileSync(path.join(target, "packages/named/index.html"), "utf8");
    assert.match(namedHtml, /<!-- webpackChunkName: "app" -->/);
    assert.equal(namedHtml.match(/<script/g)?.length, 1);
    assert.equal(html.match(/<script defer src="\.\/index.js"><\/script>/g)?.length, 1);
    const config = readFileSync(path.join(target, "webpack.config.cjs"), "utf8");
    assert.match(config, /entry: "\.\/src\/index.html"/);
    assert.match(config, /minimizeOptions: \{ html: false \}/);
    assert.doesNotMatch(config, /new HtmlWebpackPlugin/);
    assert.deepEqual(readFileSync(path.join(target, "unrelated.html")), readFileSync(path.join(fixture, "unrelated.html")));
    const rootManifest = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
    assert.ok(rootManifest.devDependencies["html-webpack-plugin"], "a skipped config still uses this package");
    assert.ok(rootManifest.devDependencies["html-loader"], "the retained legacy loader still uses this package");
    const migrated = JSON.parse(readFileSync(path.join(target, "packages/migrated/package.json"), "utf8"));
    assert.equal(migrated.devDependencies["html-webpack-plugin"], undefined);
    assert.equal(migrated.devDependencies["html-loader"], undefined);
    for (const file of ["package.json", "webpack.config.cjs", "index.html"]) {
      const relative = `packages/legacy-loader/${file}`;
      assert.deepEqual(readFileSync(path.join(target, relative)), readFileSync(path.join(fixture, relative)));
    }
    assert.equal(migrated.devDependencies["favicons-webpack-plugin"], undefined);
    const faviconConfig = readFileSync(path.join(target, "packages/migrated/webpack.config.cjs"), "utf8");
    assert.match(faviconConfig, /favicon: "\.\/logo.png"/);
    assert.match(faviconConfig, /generate the required icon sizes\/formats and web app manifest manually/);
    const skipped = "packages/skipped/webpack.config.cjs";
    assert.deepEqual(readFileSync(path.join(target, skipped)), readFileSync(path.join(fixture, skipped)));

    const once = files.map((file) => readFileSync(path.join(target, file)));
    runWorkflow(target);
    for (const [index, file] of files.entries()) {
      assert.deepEqual(readFileSync(path.join(target, file)), once[index], `second run modified ${file}`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

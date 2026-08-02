# webpack codemods — agent guide

This repository hosts codemods that upgrade webpack configurations and APIs, published to the [Codemod Registry](https://app.codemod.com/registry) and run with `npx codemod@latest run @webpack/<codemod-name>`.

## Commands

| Command                                        | What it does                        |
| ---------------------------------------------- | ----------------------------------- |
| `npm install`                                  | Install dependencies (npm, not yarn) |
| `npm test`                                     | Run every codemod's fixture tests   |
| `npm test --workspace=codemods/<codemod-name>` | Run a single codemod's tests        |
| `npm run lint` / `npm run lint:fix`            | ESLint check / autofix              |
| `npm run type-check`                           | `tsc --noEmit` over `src/` files    |

## Shared utilities

Logic reused across codemods lives in the `packages/codemod-utils/` workspace (`@webpack/codemod-utils`), split into `ast.ts` (generic ast-grep helpers: `findPair`, `namedChildren`, `unwrapFilterCall`, …), `imports.ts` (`collectModuleBindings`, a thin wrapper over the official [`@jssg/utils`](https://github.com/codemod/codemod/tree/main/packages/jssg-utils) import resolution), and `index.ts` (webpack-config helpers — `loaderNameOf`, `findConfigObjectFor`, `ruleMatchesFiles` — plus the `ConfigEditor` class: grouped removals, brace-aware insertion, EOL-aware output, unused-import cleanup). Prefer `@jssg/utils` primitives over hand-rolled AST matching when they cover the case. Import it from a codemod by adding `"@webpack/codemod-utils": "*"` to its `dependencies`; the jssg runner bundles it. Prefer extending it over copying helpers between codemods.

The utils package is internal: it is never published and stays at version `0.0.0`. When a change to it affects released codemods, add a changeset for **each affected codemod** (they bundle the utils, so they are what needs re-publishing) — CI fails the PR if utils sources change without one.

## Creating a codemod

Every codemod is a self-contained npm workspace under `codemods/<codemod-name>/`. Names are kebab-case and describe the migration (e.g. `hashed-module-ids-to-deterministic`); the published package is scoped as `@webpack/<codemod-name>`.

### Directory layout

```text
codemods/<codemod-name>/
├── README.md          # What it does + before/after example
├── codemod.yaml       # Codemod Registry manifest
├── workflow.yaml      # Workflow definition (steps, file globs)
├── package.json       # Workspace package with the `test` script
├── src/
│   └── workflow.ts    # The transform, written with jssg (ast-grep)
└── tests/
    ├── input/         # Fixtures before the transform
    └── expected/      # The same filenames after the transform
```

### File templates

#### `codemod.yaml`

```yaml
schema_version: "1.0"
name: "@webpack/<codemod-name>"
version: "1.0.0"
description: <One sentence describing the migration>
author: <github-handle> (<Name>)
license: MIT
workflow: workflow.yaml
repository: "https://github.com/webpack/codemods/tree/HEAD/codemods/<codemod-name>"
category: migration

targets:
  languages:
    - javascript
    - typescript

keywords:
  - transformation
  - migration
  - webpack

registry:
  access: public
  visibility: public
```

#### `workflow.yaml`

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/codemod-com/codemod/refs/heads/main/schemas/workflow.json

version: "1"

nodes:
  - id: apply-transforms
    name: Apply AST Transformations
    type: automatic
    runtime:
      type: direct
    steps:
      - name: <Same description as codemod.yaml>
        js-ast-grep:
          js_file: src/workflow.ts
          base_path: .
          include:
            - "**/*.cjs"
            - "**/*.js"
            - "**/*.jsx"
            - "**/*.mjs"
            - "**/*.cts"
            - "**/*.mts"
            - "**/*.ts"
            - "**/*.tsx"
          exclude:
            - "**/node_modules/**"
          language: typescript
```

Add `semantic_analysis: file` under `js-ast-grep` when the transform needs scope resolution (`node.definition()`).

#### `package.json`

```json
{
  "name": "@webpack/<codemod-name>",
  "private": true,
  "version": "1.0.0",
  "description": "<Same description as codemod.yaml>.",
  "type": "module",
  "scripts": {
    "test": "npx codemod jssg test -l typescript ./src/workflow.ts ./"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/webpack/codemods.git",
    "directory": "codemods/<codemod-name>",
    "bugs": "https://github.com/webpack/codemods/issues"
  },
  "author": "<Name> <<email>>",
  "license": "MIT",
  "homepage": "https://github.com/webpack/codemods/blob/main/codemods/<codemod-name>/README.md",
  "devDependencies": {
    "@codemod.com/jssg-types": "^1.6.2"
  }
}
```

#### `src/workflow.ts`

The transform receives an `SgRoot` and returns the rewritten source, or `null` when the file needs no changes:

```ts
import type Js from "@codemod.com/jssg-types/src/langs/javascript";
import type { Edit, SgRoot } from "@codemod.com/jssg-types/src/main";

async function transform(root: SgRoot<Js>): Promise<string | null> {
  const rootNode = root.root();

  const nodes = rootNode.findAll({
    rule: {
      pattern: "<ast-grep pattern>",
    },
  });

  if (!nodes.length) return null;

  const edits: Edit[] = [];

  for (const node of nodes) {
    const match = node.getMatch("<METAVAR>");
    if (!match) continue;
    edits.push(match.replace("<replacement>"));
  }

  if (!edits.length) return null;
  return rootNode.commitEdits(edits);
}

export default transform;
```

References: [jssg docs](https://docs.codemod.com/jssg) and [ast-grep rule reference](https://ast-grep.github.io/reference/rule.html).

### Tests

Every file in `tests/input/` must have a file with the same name in `tests/expected/` containing the post-transform output. Cover at least: a file that is transformed, a file that must remain untouched, and both CJS/ESM variants when relevant.

### Checklist before opening a PR

1. `npm install` at the repo root (registers the new workspace).
2. `npm test --workspace=codemods/<codemod-name>` passes.
3. `npm run lint` and `npm run type-check` pass.
4. The codemod is added to the table in the root `README.md`.
5. The codemod has its own `README.md` with a before/after example.

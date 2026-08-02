# Contributing

Thanks for your interest in contributing to webpack codemods!

## Setup

```sh
git clone https://github.com/webpack/codemods.git
cd codemods
npm install
```

## Repository structure

Shared helpers used by several codemods live in [`packages/codemod-utils/`](packages/codemod-utils/) (`@webpack/codemod-utils`). Each codemod lives in its own directory under [`codemods/`](codemods/) and is an npm workspace:

```text
codemods/<codemod-name>/
├── README.md          # What the codemod does, before/after examples
├── codemod.yaml       # Codemod registry manifest
├── workflow.yaml      # Workflow definition (steps, file globs)
├── package.json       # Workspace package with the `test` script
├── src/
│   └── workflow.ts    # The transform, written with jssg (ast-grep)
└── tests/
    ├── input/         # Fixture files before the transform
    └── expected/      # The same files after the transform
```

## Adding a new codemod

1. Create a new directory under `codemods/` with the structure above. Use a short, kebab-case name that describes the migration (see [AGENTS.md](AGENTS.md) for file templates).
2. Update `codemod.yaml`, `workflow.yaml`, `package.json`, and `README.md` with the new name and description. The package name must be scoped as `@webpack/<codemod-name>`.
3. Write the transform in `src/workflow.ts`. See the [jssg documentation](https://docs.codemod.com/jssg) and the [ast-grep rule reference](https://ast-grep.github.io/reference/rule.html).
4. Add fixtures: every file in `tests/input/` must have a matching file in `tests/expected/`.
5. Add the codemod to the table in the root [README.md](README.md).

## Testing

Run all codemod tests:

```sh
npm test
```

Run the tests of a single codemod:

```sh
npm test --workspace=codemods/<codemod-name>
```

## Linting and type checking

```sh
npm run lint        # eslint .
npm run lint:fix    # eslint . --fix
npm run type-check  # tsc --noEmit
```

## Publishing

Codemods are published to the [Codemod Registry](https://app.codemod.com/registry) from CI when changes land on `main`.

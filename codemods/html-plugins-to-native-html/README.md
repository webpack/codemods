# @webpack/html-plugins-to-native-html

Migrates webpack configurations from `html-webpack-plugin` and `html-loader` to webpack's native HTML support (`experiments.html` + `output.html`).

> Requires **webpack >= 5.109.0**: the transform relies on the `output.html` options (`title`, `meta`, `favicon`, `base`, `inject`, …) introduced there.

## What it does

- Removes `new HtmlWebpackPlugin(...)` from `plugins` (and the whole `plugins` entry when it becomes empty), and the `html-webpack-plugin` `require`/`import` once it is unused.
- Enables the native pipeline with `experiments: { html: true }` and `output.html` on each migrated configuration.
- Sets `output.htmlFilename` to the plugin's `filename` — or to `"index.html"`, the plugin's default, since the native default is `[name].html`.
- Maps plugin options to their `output.html` counterparts: `title`, `meta` (string values), `favicon`, `base`, `inject` (`"body"`/`"head"`/`false`; `true` is the native default), and `scriptLoading: "blocking"` (`"defer"` is the native default).
- Drops options the native pipeline covers on its own (`minify: true`/`"auto"`, `cache`, `showErrors`, `chunksSortMode`, `chunks: "all"`, `publicPath: "auto"`) silently.
- Options without a native equivalent (`hash`, a `minify` object, `chunks` arrays, `templateContent`, `templateParameters`, …) are dropped with a `// Removed html-webpack-plugin options without a native HTML equivalent: …` comment so you can review the behavior change; a manual migration path is appended where one exists.

### `html-loader`

- Removes rules that only wire up `html-loader` (cascading to empty `rules`/`module` entries): with no user rule matching `.html`, webpack's `experiments.html: "auto"` default enables native HTML by itself, and importing an `.html` file from JS natively yields the processed HTML string — the same shape `html-loader` exported.
- Rules with extra conditions or surviving options are kept with `type: "html"` instead — and since their presence disables the `"auto"` default, `experiments.html: true` is added to that configuration.
- Any other loader in the chain (template compilers, custom ones) keeps working in front of native HTML: it stays in `use` while `html-loader` is dropped.
- Loader options: boolean `sources` becomes the rule's `parser: { sources }`; `esModule` and `minimize` are dropped silently (native HTML covers them); a `sources` object or `preprocessor` function is flagged with a review comment (`preprocessor` maps manually to the rule's `parser.template`, which is synchronous and receives `(source, { module, resource })`).

### `template`

`output.html` generates each page from scratch, so an authored template maps to webpack's other native mode instead: the **HTML entry point**. The codemod turns the template into the entry and leaves a review comment — you must reference the previous JS entry from the template yourself, e.g. `<script defer src="./src/index.js"></script>`, because the HTML file now drives the build. Since head tags are only injected into webpack-generated pages, `title`/`meta`/`favicon`/`base` are flagged to be added to the template instead.

### What is left untouched

- Configurations with **several** plugin instances (multi-page setups with `chunks` per page): they map to per-entry `html` descriptors, but doing that safely needs a human — see [the entry `html` option](https://webpack.js.org/concepts/entry-points/).
- Files that tap `HtmlWebpackPlugin.getHooks(...)`: the taps have no drop-in native counterpart (native hooks live on `HtmlModulesPlugin.getCompilationHooks(...)` with different stages).
- Plugin instantiations whose options are not an object literal.

## Usage

```sh
npx codemod run @webpack/html-plugins-to-native-html
```

## Example

Before:

```js
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  plugins: [
    new HtmlWebpackPlugin({
      filename: "app.html",
      title: "My App",
      meta: { viewport: "width=device-width, initial-scale=1" },
    }),
  ],
};
```

After:

```js
module.exports = {
  output: {
    html: { title: "My App", meta: { viewport: "width=device-width, initial-scale=1" } },
    htmlFilename: "app.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
};
```

With a `template`, the template becomes the entry point:

```js
module.exports = {
  experiments: {
    html: true,
  },
  // The template is now the entry: reference the previous entry from it, e.g. <script defer src="./src/index.js"></script>
  entry: "./src/index.html",
  output: {
    htmlFilename: "index.html",
  },
};
```

The codemod also removes `html-webpack-plugin` and `html-loader` from your `package.json` (`dependencies` and `devDependencies`). If other tooling in the repo still uses them (Storybook, test setups, …), reinstall the ones you need.

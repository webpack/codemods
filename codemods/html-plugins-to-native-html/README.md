# @webpack/html-plugins-to-native-html

Migrates webpack configurations from `html-webpack-plugin` and `html-loader` to webpack's native HTML support (`experiments.html` + `output.html`).

> Requires **webpack >= 5.111.0**: the transform uses native HTML generation and the built-in HTML minifier, configured through `optimization.minimizeOptions.html`.

## What it does

- Removes `new HtmlWebpackPlugin(...)` from `plugins` (and the whole `plugins` entry when it becomes empty), and the `html-webpack-plugin` `require`/`import` once it is unused.
- Enables the native pipeline with `experiments: { html: true }` and `output.html` on each migrated configuration.
- Sets `output.htmlFilename` to the plugin's `filename` — or to `"index.html"`, the plugin's default, since the native default is `[name].html`.
- Maps plugin options to their `output.html` counterparts: `title`, `meta` (string values, plus `{ name | property, content }` objects — `og:*` keys included), `favicon`, `base`, `inject` (`"body"`/`"head"`/`false`; `true` is the native default), and `scriptLoading` — `"blocking"` maps directly, `"defer"` is the native default, and `"module"` becomes `output.module: true` (stable ESM output since webpack 5.111; obsolete literal `experiments.outputModule` flags are removed).
- Uses webpack's built-in HTML minifier and translates supported `minify` options to `optimization.minimizeOptions.html`; see [Minification](#minification). Build-only options (`cache`, `showErrors`, `chunksSortMode`, `chunks: "all"`, `publicPath: "auto"`) are dropped.
- **Multi-page setups**: several instances (or a `chunks: ["name"]` list) map to per-entry `html` descriptors — each listed entry becomes `{ import: …, html: <options> }`, unlisted entries get no page, and `output.htmlFilename: "[name].html"` covers the per-page filenames. Requires each instance to own exactly one entry via `chunks` and no `template`; instance filenames other than `<entry>.html`/`[name].html` are flagged.
- Options without a native equivalent (`hash`, unsupported `minify` settings, `chunks` arrays, `templateContent`, `templateParameters`, …) are dropped with a `// Removed html-webpack-plugin options without a native HTML equivalent: …` comment so you can review the behavior change; a manual migration path is appended where one exists.
- **Companion plugins** found next to a migrated `html-webpack-plugin` instance are migrated too: `csp-html-webpack-plugin` → `output.html.csp` (its policy argument becomes `csp.policy`), `webpack-subresource-integrity` → `output.html.integrity` (`hashFuncNames` becomes the algorithm list; `enabled: false` just removes it), and `favicons-webpack-plugin` → `output.html.favicon` (a literal logo path becomes a single icon). Favicon migration always adds a review comment: generate the additional icon sizes/formats and web app manifest manually and configure their links. Native HTML does not reproduce that generation. Options beyond that are dropped with a review comment; instances whose arguments can't be understood are left in place with a comment. In template/multi-page modes options that only apply to generated pages are flagged instead.
- Migrates `HtmlWebpackPlugin.getHooks(...)` taps to the native `webpack.html.HtmlModulesPlugin.getCompilationHooks(...)` stage covering the same moment: `alterAssetTags`/`alterAssetTagGroups` → `transformTags`, `beforeEmit` → `transformHtml`, `afterEmit` → `htmlEmitted`. The native stages take different arguments (`transformTags` hands you mutable tag descriptors instead of `data.assetTags`/head-body arrays; `transformHtml` is a waterfall on the HTML string instead of `data.html`), so each renamed tap gets a `// Review: …` comment describing the new signature — review the callback body.

### `html-loader`

- Removes rules that only wire up `html-loader` (cascading to empty `rules`/`module` entries): with no user rule matching `.html`, webpack's `experiments.html: "auto"` default enables native HTML by itself, and importing an `.html` file from JS natively yields the processed HTML string — the same shape `html-loader` exported.
- Rules with extra conditions or surviving options are kept with `type: "html"` instead — and since their presence disables the `"auto"` default, `experiments.html: true` is added to that configuration.
- Any other loader in the chain (template compilers, custom ones) keeps working in front of native HTML: it stays in `use` while `html-loader` is dropped.
- Loader options: boolean `sources` becomes the rule's `parser: { sources }`, and static `sources.list` arrays become `parser.sources` (including `"..."`, `src` and `srcset` entries); `esModule` is dropped (native exports are ESM), and `minimize` uses the same native minifier option mapping as the plugin; a `preprocessor` function is flagged with a review comment (`preprocessor` maps manually to the rule's `parser.template`, which is synchronous and receives `(source, { module, resource })`).

### `template`

`output.html` generates each page from scratch, so an authored template maps to webpack's other native mode instead: the **HTML entry point**. The configuration transform makes the template the entry and records the previous JS entry in workflow state. A separate HTML AST transform adds the corresponding `<script defer src="…"></script>` before `</head>` (or `</body>`), preserving line endings and avoiding duplicate script references. Comments containing script markup do not count as existing scripts.

All changes are returned to the codemod runner; the transforms do not use filesystem APIs. This keeps template changes inside the normal workflow and makes `--dry-run` safe. Only `.html` templates included in the workflow are edited. The configuration keeps a review comment with the script reference for missing/excluded templates and when running the configuration transform alone. Since head tags are only injected into webpack-generated pages, `title`/`meta`/`favicon`/`base` are flagged to be added to the template instead.

### What is left untouched

- Configurations using dynamic or spread favicon options without a statically known logo path; their HTML plugin and loaders are kept together.
- Multi-page configurations the per-entry shape can't express: an instance whose `chunks` lists several entries (one page aggregating several chunks), combines `chunks` with `template`, or names an entry the config's `entry` object doesn't declare.
- Files that tap `beforeAssetTagGeneration` or `afterTemplateExecution` via `HtmlWebpackPlugin.getHooks(...)`: those stages have no native equivalent (webpack builds the tags and runs the parser template itself).
- Plugin instantiations whose options are not an object literal, or contain spreads/shorthand properties.
- Configurations with computed `output` or `experiments`, dynamic template paths, or templates whose JS entry cannot be represented by a single script.
- Multi-page configurations with different minification settings per page: native minification applies to the whole compilation.
- Rules whose existing dynamic `parser` or `experiments` cannot safely receive the migrated settings, or whose parser options conflict with the migrated values.
- Loader source lists with callbacks (`filter`/`urlFilter`), `scriptingEnabled`, dynamic expressions or spreads; these require manual adaptation to the native API.

### Minification

The [built-in HTML minifier](https://webpack.js.org/configuration/optimization/#optimizationminimizeoptions) needs no additional package. Absent options, `minify: true`, and `minify: "auto"` use webpack's defaults. The codemod preserves `mode` and `optimization.minimize`: minification runs in production by default. If the old plugin explicitly minified in development, set `optimization.minimize: true` after migration; this also enables the other configured minimizers.

Both plugin `minify` and loader `minimize` accept these translations:

| Original setting | Native setting under `optimization.minimizeOptions` |
| --- | --- |
| `false` | `html: false` (JS/CSS keep their settings) |
| `collapseWhitespace`, `collapseBooleanAttributes`, `minifyConditionalComments`, `removeEmptyAttributes`, `removeEmptyElements`, `removeRedundantAttributes`, `sortAttributes` | Same boolean property in `html` |
| `removeComments` | Inverted `html.comments` |
| `removeAttributeQuotes` | `html.normalizeAttributeQuotes` |
| `removeOptionalTags` | Both `html.removeOptionalTags` and `html.removeImpliedTags` |
| `conservativeCollapse: true` | Covered by native whitespace handling |

For example, `new HtmlWebpackPlugin({ minify: { removeComments: false, collapseWhitespace: false } })` adds:

```js
optimization: {
  minimizeOptions: {
    html: { comments: true, collapseWhitespace: false },
  },
},
```

Existing native HTML minification options take precedence and receive a review comment. Other asset types' settings are preserved, including the `optimization.minimize: { javascript: … }` shorthand. A custom literal `optimization.minimizer` list gets `"..."` appended once, after its existing plugins, to restore webpack's default minimizers; this also restores default JS/CSS processing for assets the custom plugins leave unminimized. A migration that disables HTML minification does not add that default entry. Dynamic optimization/minimizer values receive instructions for manual integration.

The native minifier has different whitespace and attribute normalization rules from `html-minifier-terser`; this is not a byte-for-byte output conversion. Unknown or dynamic options, including embedded `minifyJS`/`minifyCSS` options, get review comments instead of being passed to an incompatible API. Loader settings become compilation-wide settings. Conflicting loader/page settings are flagged for manual review.

## Usage

```sh
npx codemod run @webpack/html-plugins-to-native-html
```

The workflow runs the configuration, HTML-template, and dependency transforms in sequence. It does not require filesystem permissions.

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

With a `template`, the template becomes the entry point and gets a `<script>` tag for the previous entry added to it:

```js
module.exports = {
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <script defer src="./index.js"></script> (added by the HTML workflow step when the template is included)
  entry: "./src/index.html",
  output: {
    htmlFilename: "index.html",
  },
};
```

After migration, the codemod removes unused `html-webpack-plugin`, `html-loader`, and supported companion plugins from `dependencies` and `devDependencies`. The configuration step records remaining package references in workflow state, scoped by source filename. The JSON transform combines those references with other manifest fields, preserving packages still referenced beneath that manifest by skipped configs or other tooling. Running the JSON transform alone keeps dependencies because no source-reference scan is available. Run your package manager afterward to update the lockfile.

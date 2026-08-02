# @webpack/css-plugins-to-native-css

Migrates webpack configurations from `mini-css-extract-plugin` and `style-loader`/`css-loader` rules to webpack's [native CSS support](https://webpack.js.org/configuration/experiments/#experimentscss) (`experiments.css`).

> Requires **webpack >= 5.109.0**: the transform relies on the `experiments.css: "auto"` default introduced there, which enables native CSS whenever no user rule matches `.css` files.

## What it does

- Removes rules that only wire up `style-loader`, `css-loader`, and/or `MiniCssExtractPlugin.loader` (cascading to empty `rules`/`module` entries): with no user rule matching `.css`, webpack's `experiments.css: "auto"` default enables native CSS by itself, so no explicit option is needed.
- Rules with extra conditions (e.g. `include`) are kept with `type: "css/auto"` instead — and since their presence disables the `"auto"` default, `experiments.css: true` is added to that configuration.
- Any other loader in the chain (`sass-loader`, `less-loader`, `postcss-loader`, custom ones, …) keeps working in front of native CSS: it stays in `use` while the injection/extraction loaders are dropped, and the rule gets `type: "css/auto"`.
- Removes `new MiniCssExtractPlugin(...)` from `plugins` (and the whole `plugins` entry when it becomes empty), migrating its options to their native counterparts: `filename` → `output.cssFilename`, `chunkFilename` → `output.cssChunkFilename`.
- Removes the `mini-css-extract-plugin` `require`/`import` once it is unused.
- Understands conditional patterns (including ejected Create React App configs): the `isDev ? "style-loader" : MiniCssExtractPlugin.loader` ternary, `isEnvDevelopment && "style-loader"` guards, `require.resolve("css-loader")`, and `[...].filter(Boolean)` around `use` and `plugins`. Function-form configs (`module.exports = (env) => ({...})`) and `webpack-merge` fragments work too.
- Loader options are checked while migrating: `importLoaders`, `sourceMap`, and `esModule` are dropped silently (native CSS covers them). Semantic options native CSS cannot replicate — css-loader's `url`/`import`/`exportType`, style-loader's `insert`/`attributes`, `MiniCssExtractPlugin.loader`'s `publicPath`, or css-loader's `modules` on a rule that also matches plain `.css` files — are dropped too, but the rule keeps a `// Removed loader options without a native CSS equivalent: …` comment so you can review the behavior change. `modules` on a rule scoped to `.module.css` matches the `css/auto` convention and migrates silently.

The remaining `MiniCssExtractPlugin` options have **no native equivalent** and are dropped: `ignoreOrder`, `insert`, `attributes`, `linkType`, `runtime`, and `experimentalUseImportModule`. Review your build if you relied on them.

Only rules the file demonstrably owns as webpack config are transformed (a `rules`/`oneOf` array, a `module` block, or an import of `mini-css-extract-plugin`). Rule fragments pushed into another tool's webpack config — Storybook's `webpackFinal`, craco, and similar — are never modified: those tools ship their own webpack, where a partial migration would break the build.

## Usage

```sh
npx codemod@latest run @webpack/css-plugins-to-native-css
```

## Example

Before:

```js
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};
```

After:

```js
module.exports = {};
```

Native CSS handles `.css` (and `.module.css`) files out of the box. Preprocessor rules keep their loader in front of it:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: ["sass-loader"],
        type: "css/auto",
      },
    ],
  },
};
```

When a rule matching `.css` carries extra conditions it is preserved too — and since its presence turns off the `experiments.css: "auto"` default, the option is set explicitly:

```js
module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        include: path.resolve(__dirname, "src"),
        type: "css/auto",
      },
    ],
  },
};
```

Remember to also remove `mini-css-extract-plugin`, `style-loader`, and `css-loader` from your `package.json` if nothing else uses them.

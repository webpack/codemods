# @webpack/css-plugins-to-native-css

Migrates webpack configurations from `mini-css-extract-plugin` and `style-loader`/`css-loader` rules to webpack's [native CSS support](https://webpack.js.org/configuration/experiments/#experimentscss) (`experiments.css`).

## What it does

- Removes rules that only wire up `style-loader`, `css-loader`, and/or `MiniCssExtractPlugin.loader` (cascading to empty `rules`/`module` entries): with no user rule matching `.css`, webpack's `experiments.css: "auto"` default enables native CSS by itself, so no explicit option is needed.
- Rules with extra conditions (e.g. `include`) are kept with `type: "css/auto"` instead — and since their presence disables the `"auto"` default, `experiments.css: true` is added to that configuration.
- Removes `new MiniCssExtractPlugin(...)` from `plugins` (and the whole `plugins` entry when it becomes empty).
- Removes the `mini-css-extract-plugin` `require`/`import` once it is unused.

Rules that still need a preprocessor (`sass-loader`, `less-loader`, `stylus-loader`, `postcss-loader`, …) are left untouched.

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

Native CSS handles `.css` (and `.module.css`) files out of the box. When a rule carries extra conditions it is preserved instead:

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

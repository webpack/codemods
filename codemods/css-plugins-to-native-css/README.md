# @webpack/css-plugins-to-native-css

Migrates webpack configurations from `mini-css-extract-plugin` and `style-loader`/`css-loader` rules to webpack's [native CSS support](https://webpack.js.org/configuration/experiments/#experimentscss) (`experiments.css`).

## What it does

- Replaces `use` arrays made up of `style-loader`, `css-loader`, and/or `MiniCssExtractPlugin.loader` with `type: "css/auto"`.
- Removes `new MiniCssExtractPlugin(...)` from `plugins` (and the whole `plugins` entry when it becomes empty).
- Removes the `mini-css-extract-plugin` `require`/`import` once it is unused.
- Enables `experiments.css: true` on the affected configuration.

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
module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
      },
    ],
  },
};
```

Remember to also remove `mini-css-extract-plugin`, `style-loader`, and `css-loader` from your `package.json` if nothing else uses them.

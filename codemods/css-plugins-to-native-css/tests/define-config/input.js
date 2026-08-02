const { defineConfig } = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = defineConfig({
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
});

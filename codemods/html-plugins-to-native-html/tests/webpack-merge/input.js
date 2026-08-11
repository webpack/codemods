const { merge } = require("webpack-merge");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const base = require("./webpack.base");

module.exports = merge(base, {
  entry: "./src/index.js",
  plugins: [new HtmlWebpackPlugin({ title: "App" })],
});

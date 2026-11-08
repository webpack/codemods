const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  output: { html: { title: "Native title" }, htmlFilename: "native.html" },
  experiments: { html: true },
  plugins: [new HtmlWebpackPlugin({ title: "Plugin title", favicon: "./icon.png", hash: true })],
};

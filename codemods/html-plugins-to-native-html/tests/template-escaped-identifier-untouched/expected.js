const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: { app\u0041: "./src/index.js" },
  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })],
};

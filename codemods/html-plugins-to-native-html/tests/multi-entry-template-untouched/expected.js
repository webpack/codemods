const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  entry: ["./polyfill.js", "./app.js"],
  plugins: [new HtmlWebpackPlugin({ template: "./index.html" })],
};

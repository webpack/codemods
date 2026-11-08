const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  entry: { app: "./index.js" },
  plugins: [new HtmlWebpackPlugin({ template: "./index.html" })],
};

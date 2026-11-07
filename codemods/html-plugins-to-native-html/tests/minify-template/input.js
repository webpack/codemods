const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  entry: "./src/app.js",
  plugins: [new HtmlWebpackPlugin({ template: "./src/app.html", minify: false })],
};

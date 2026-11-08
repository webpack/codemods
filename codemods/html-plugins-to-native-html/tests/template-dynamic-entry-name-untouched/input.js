const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = [
  { entry: { [getName()]: "./src/index.js" }, plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })] },
  { entry: { ...entries, app: "./src/index.js" }, plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })] },
];

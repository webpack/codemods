const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = (env) => ({
  entry: "./src/index.js",
  plugins: [new HtmlWebpackPlugin()],
});

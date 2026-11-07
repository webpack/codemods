const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: { minimize: { javascript: false }, minimizer: [] },
  plugins: [new HtmlWebpackPlugin({ minify: { collapseWhitespace: false } })],
};

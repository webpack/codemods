const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: getOptimization(),
  plugins: [new HtmlWebpackPlugin({ minify: false })],
};

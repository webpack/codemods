const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: { minimizer: [] },
  plugins: [new HtmlWebpackPlugin({ minify: false })],
};

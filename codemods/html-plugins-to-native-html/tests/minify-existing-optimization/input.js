const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: {
    minimize: false,
    minimizeOptions: { javascript: { mangle: false }, css: false },
    minimizer: [new CustomMinimizer(), /* keep this comment */],
  },
  plugins: [new HtmlWebpackPlugin({ minify: { removeComments: true } })],
};

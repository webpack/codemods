const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: {
    minimize: { html: { comments: true }, javascript: false },
    minimizer: ["...", new CustomMinimizer()],
  },
  plugins: [new HtmlWebpackPlugin({ minify: false })],
};

const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: { minimizer: makeMinimizers(), minimizeOptions: getOptions() },
  plugins: [new HtmlWebpackPlugin({ minify: { removeComments: true } })],
};

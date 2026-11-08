const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  optimization: { minimizer: [new CustomMinimizer()] },
  plugins: [new HtmlWebpackPlugin()],
};

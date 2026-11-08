const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = {
  module: { rules: [{ test: /\.css$/, use: [MiniCssExtractPlugin.loader, "css-loader"] }] },
  plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
  optimization: { minimizer: ["...", new CssMinimizerPlugin()] },
};

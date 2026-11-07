const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  experiments: { html: false, outputModule: false },
  output: { html: false, module: false },
  plugins: [new HtmlWebpackPlugin({ scriptLoading: "module" })],
};

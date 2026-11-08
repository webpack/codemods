const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = (CssMinimizerPlugin) => ({
  optimization: { minimizer: [new CssMinimizerPlugin()] },
});

const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { mode: "development", optimization: { minimize: false, minimizer: [new CssMinimizerPlugin()] } };

const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimize: { javascript: false }, minimizer: ["...", new CssMinimizerPlugin()] } };

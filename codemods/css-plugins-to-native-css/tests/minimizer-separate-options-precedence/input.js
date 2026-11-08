const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimize: { css: false }, minimizeOptions: { javascript: false }, minimizer: ["...", new CssMinimizerPlugin()] } };

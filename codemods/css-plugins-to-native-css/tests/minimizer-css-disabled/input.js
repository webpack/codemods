const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { css: false }, minimizer: ["...", new CssMinimizerPlugin()] } };

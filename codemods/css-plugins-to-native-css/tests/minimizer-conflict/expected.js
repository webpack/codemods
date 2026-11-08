const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { css: { comments: false } }, minimizer: ["...", new CssMinimizerPlugin()] } };

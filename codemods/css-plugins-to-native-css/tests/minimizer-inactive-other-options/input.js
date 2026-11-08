const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { javascript: { compress: false } }, minimizer: [new CssMinimizerPlugin()] } };

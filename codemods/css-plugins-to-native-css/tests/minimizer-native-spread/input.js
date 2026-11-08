const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { ...options }, minimizer: ["...", new CssMinimizerPlugin()] } };

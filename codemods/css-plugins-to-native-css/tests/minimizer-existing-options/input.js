const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { javascript: { compress: false }, css: { mergeRules: false } }, minimizer: ["...", new CssMinimizerPlugin({ minimizerOptions: { preset: ["default", { mergeRules: false }] } })] } };

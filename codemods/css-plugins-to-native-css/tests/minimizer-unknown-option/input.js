const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin({ minimizerOptions: { preset: ["default", { unknown: false }] } })] } };

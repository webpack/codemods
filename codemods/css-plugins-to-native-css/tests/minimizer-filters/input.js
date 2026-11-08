const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin({ include: /vendor/, minimizerOptions: { preset: "default" } })] } };

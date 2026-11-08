const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin({ parallel: true, minify: CssMinimizerPlugin.cssnanoMinify, minimizerOptions: { preset: "default" } })] } };

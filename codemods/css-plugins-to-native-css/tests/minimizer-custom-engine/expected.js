const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin({ minify: CssMinimizerPlugin.lightningCssMinify, minimizerOptions: { targets: { chrome: 80 } } })] } };

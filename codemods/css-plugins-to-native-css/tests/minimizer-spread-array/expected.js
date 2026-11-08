const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: [...otherMinimizers, new CssMinimizerPlugin()] } };

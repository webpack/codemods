const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", isProduction && new CssMinimizerPlugin()].filter(Boolean) } };

let CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
CssMinimizerPlugin = CustomPlugin;
module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin()] } };

const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

console.log(CssMinimizerPlugin);
module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin()] } };

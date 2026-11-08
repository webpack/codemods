const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: ["...", new CssMinimizerPlugin({ minimizerOptions: { preset: ["default", { calc: false, reduceTransforms: true, discardEmpty: { exclude: true }, discardDuplicates: {}, convertValues: false, merge: { rules: false } }] } })] } };

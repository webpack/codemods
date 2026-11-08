const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

console.log(CssMinimizerPlugin);
module.exports = { optimization: { minimizeOptions: { css: { comments: /^!/, extractComments: false } }, minimizer: ["..."] } };

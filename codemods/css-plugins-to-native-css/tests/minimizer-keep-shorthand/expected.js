const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizeOptions: { css: { comments: /^!/, extractComments: false } }, minimizer: ["..."] } };
const otherTools = { CssMinimizerPlugin };

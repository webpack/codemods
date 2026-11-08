const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = { optimization: { minimizer: [new TerserPlugin({ extractComments: false }), new CssMinimizerPlugin()] } };

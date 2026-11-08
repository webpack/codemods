const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

module.exports = {
  mode: "production",
  optimization: {
    minimize: true,
    minimizer: ["...", new CssMinimizerPlugin({
      minimizerOptions: {
        preset: ["default", {
          discardComments: { removeAll: true },
          colormin: false,
          mergeLonghand: false,
          mergeRules: false,
          discardEmpty: false,
          normalizeString: false,
          calc: false,
          minifySelectors: false,
          minifyParams: false,
          reduceInitial: false,
          cssDeclarationSorter: false,
          convertValues: { length: true },
        }],
      },
    })],
  },
};

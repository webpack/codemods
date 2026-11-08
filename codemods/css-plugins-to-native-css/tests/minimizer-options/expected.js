module.exports = {
  mode: "production",
  optimization: {
    minimizeOptions: { css: { comments: false, extractComments: false, shortenColors: false, mergeLonghands: false, mergeRules: false, mergeDistantRules: false, removeDeadRules: false, normalizeQuotes: false, reduceFunctions: false, shortenSelectors: false, shortenMediaQueries: false, shortenValues: false, reorderDeclarations: false, convertLengthUnits: true } },
    minimize: true,
    minimizer: ["..."],
  },
};

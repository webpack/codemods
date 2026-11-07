export default {
  optimization: { minimizeOptions: { html: { collapseWhitespace: false, collapseBooleanAttributes: true, comments: true, extractComments: false, normalizeAttributeQuotes: true, removeOptionalTags: false, removeImpliedTags: false, removeEmptyAttributes: true, removeRedundantAttributes: false, sortAttributes: true } } },
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: minify.minifyJS (configure optimization.minimizeOptions.html), minify.options (configure optimization.minimizeOptions.html)
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  mode: "development",
};

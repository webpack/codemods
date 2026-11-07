module.exports = {
  output: {
    // Review: existing native HTML minification options take precedence over migrated minify/minimize options
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: {
    minimize: { html: { comments: true }, javascript: false },
    minimizer: ["...", new CustomMinimizer()],
  },
};

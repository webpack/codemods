module.exports = {
  output: {
    // Review: keep "..." in optimization.minimizer to enable native HTML minification
    // Review: merge the HTML minification options into the existing optimization.minimizeOptions value
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: { minimizer: makeMinimizers(), minimizeOptions: getOptions() },
};

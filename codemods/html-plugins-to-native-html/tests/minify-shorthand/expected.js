module.exports = {
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: { minimize: { html: { collapseWhitespace: false }, javascript: false }, minimizer: [ "..."] },
};

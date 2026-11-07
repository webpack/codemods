module.exports = {
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: minify (configure optimization.minimizeOptions.html)
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
};

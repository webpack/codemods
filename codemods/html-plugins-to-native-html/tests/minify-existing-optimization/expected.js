module.exports = {
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: {
    minimize: false,
    minimizeOptions: { html: { comments: false }, javascript: { mangle: false }, css: false },
    minimizer: [new CustomMinimizer(), "...", /* keep this comment */],
  },
};

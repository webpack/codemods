module.exports = {
  output: {
    // Review: configure the existing optimization value to use webpack's native HTML minimizer (minimizeOptions.html and minimizer: ["..."])
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: getOptimization(),
};

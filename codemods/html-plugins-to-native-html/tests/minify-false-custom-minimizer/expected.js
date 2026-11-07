module.exports = {
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  optimization: { minimizeOptions: { html: false }, minimizer: [] },
};

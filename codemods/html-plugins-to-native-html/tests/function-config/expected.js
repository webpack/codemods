module.exports = (env) => ({
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
});

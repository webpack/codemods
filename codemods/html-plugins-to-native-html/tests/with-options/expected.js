module.exports = {
  output: {
    html: { title: "My App", meta: { viewport: "width=device-width, initial-scale=1" }, inject: "head", scriptLoading: "blocking", favicon: "./src/favicon.ico" },
    htmlFilename: "app.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
};

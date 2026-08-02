module.exports = {
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: meta.refresh
    html: { meta: { viewport: "width=device-width, initial-scale=1", "og:title": "My App" } },
    htmlFilename: "index.html",
    module: true,
  },
  experiments: {
    html: true,
    outputModule: true,
  },
  entry: "./src/index.js",
};

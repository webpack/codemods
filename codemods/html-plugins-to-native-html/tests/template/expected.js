module.exports = {
  experiments: {
    html: true,
  },
  // The template is now the entry: reference the previous entry from it, e.g. <script defer src="./src/index.js"></script>
  entry: "./src/index.html",
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: title (add it to the template)
    htmlFilename: "index.html",
    filename: "[name].js",
  },
};

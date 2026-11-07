module.exports = {
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <script defer src="./index.js"></script> (added by the HTML workflow step when the template is included)
  entry: "./src/index.html",
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: title (add it to the template)
    htmlFilename: "index.html",
    filename: "[name].js",
  },
};

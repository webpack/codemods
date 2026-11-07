module.exports = {
  optimization: { minimizeOptions: { html: false } },
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <script defer src="./app.js"></script> (added by the HTML workflow step when the template is included)
  entry: "./src/app.html",
};

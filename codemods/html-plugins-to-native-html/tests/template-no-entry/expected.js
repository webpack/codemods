module.exports = {
  // The template is now the entry: it must load the previous default entry via <!-- webpackChunkName: "main" --> <script defer src="../src/index.js"></script> (added by the HTML workflow step when the template is included)
  entry: "./public/index.html",
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
};

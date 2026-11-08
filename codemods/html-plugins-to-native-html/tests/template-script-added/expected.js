module.exports = {
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <!-- webpackChunkName: "main" --> <script defer src="./index.js"></script> (added by the HTML workflow step when the template is included)
  entry: "./src/index.html",
};

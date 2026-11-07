module.exports = {
  output: {
    htmlFilename: "main.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <!-- webpackChunkName: "main" --> <script defer src="./main.js"></script> (added by the HTML workflow step when the template is included)
  entry: {
    main: "./src/index.html",
  },
};

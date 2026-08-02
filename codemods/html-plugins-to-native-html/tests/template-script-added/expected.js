module.exports = {
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <script defer src="./index.js"></script> (added automatically when the template was found on disk)
  entry: "./src/index.html",
};

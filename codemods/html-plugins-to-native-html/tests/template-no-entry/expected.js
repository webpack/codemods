module.exports = {
  // The template is now the entry: it must load the previous default entry via <script defer src="../src/index.js"></script> (added automatically when the template was found on disk)
  entry: "./public/index.html",
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
};

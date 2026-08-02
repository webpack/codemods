module.exports = {
  output: {
    htmlFilename: "main.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: it must load the previous entry via <script defer src="./main.js"></script> (added automatically when the template was found on disk)
  entry: {
    main: "./src/index.html",
  },
};

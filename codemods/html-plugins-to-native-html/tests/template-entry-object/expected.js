module.exports = {
  output: {
    htmlFilename: "main.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry: reference the previous entry from it, e.g. <script defer src="./src/main.js"></script>
  entry: {
    main: "./src/index.html",
  },
};

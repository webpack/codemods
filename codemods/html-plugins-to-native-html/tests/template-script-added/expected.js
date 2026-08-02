module.exports = {
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  // The template is now the entry and loads the previous entry via <script defer src="./index.js"></script>
  entry: "./src/index.html",
};

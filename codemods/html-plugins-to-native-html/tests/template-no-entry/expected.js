module.exports = {
  // The template is now the entry: reference the previous entry (webpack's default is ./src/index.js) from it, e.g. <script defer src="./src/index.js"></script>
  entry: "./public/index.html",
  output: {
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
};

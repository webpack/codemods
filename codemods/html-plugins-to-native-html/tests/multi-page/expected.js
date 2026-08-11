module.exports = {
  output: {
    htmlFilename: "[name].html",
  },
  experiments: {
    html: true,
  },
  entry: { a: { import: "./src/a.js", html: true }, b: { import: "./src/b.js", html: true } },
};

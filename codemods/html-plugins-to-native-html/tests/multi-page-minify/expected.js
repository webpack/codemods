module.exports = {
  optimization: { minimizeOptions: { html: false } },
  output: {
    htmlFilename: "[name].html",
  },
  experiments: {
    html: true,
  },
  entry: { app: { import: "./app.js", html: true }, admin: { import: "./admin.js", html: true } },
};

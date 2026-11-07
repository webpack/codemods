module.exports = {
  optimization: { minimizeOptions: { html: { collapseWhitespace: true } } },
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: hash (use [contenthash] in output.htmlFilename), publicPath (set output.publicPath)
    // output.html emits one page per entry; html-webpack-plugin emitted a single page with every chunk
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: {
    app: "./src/app.js",
    admin: "./src/admin.js",
  },
};

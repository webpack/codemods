module.exports = {
  output: {
    // Removed html-webpack-plugin options without a native HTML equivalent: hash (use [contenthash] in output.htmlFilename), minify (production HTML is minified by default; customize via optimization.minimizer (minimizer-webpack-plugin)), publicPath (set output.publicPath)
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

const { merge } = require("webpack-merge");
const base = require("./webpack.base");

module.exports = merge(base, {
  output: {
    html: { title: "App" },
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
});

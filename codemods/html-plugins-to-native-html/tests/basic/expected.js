const { DefinePlugin } = require("webpack");

module.exports = {
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
  output: {
    html: true,
    htmlFilename: "index.html",
    filename: "[name].js",
  },
  plugins: [
    new DefinePlugin({ DEBUG: "false" }),
  ],
};

const Html = require("html-webpack-plugin");
module.exports = {
  entry: "./src/index.js",
  module: { rules: [
    { test: /\.html$/, loader: "html-loader" },
    { test: /\.other.html$/, loader: "html-loader", options: { postprocessor: (html) => html.replace(/App/g, "Title") } },
  ] },
  plugins: [new Html({ template: "./src/index.html" })],
};

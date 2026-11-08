const Html = require("html-webpack-plugin");
module.exports = {
  entry: "./index.js",
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { postprocessor: (html) => html.replace(/Title/g, "App") } }] },
  plugins: [new Html({ template: "./index.html" })],
};

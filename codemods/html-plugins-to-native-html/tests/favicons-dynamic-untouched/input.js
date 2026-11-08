const Html = require("html-webpack-plugin");
const Icons = require("favicons-webpack-plugin");
module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader" }] },
  plugins: [new Html(), new Icons({ logo: getLogo() })],
};

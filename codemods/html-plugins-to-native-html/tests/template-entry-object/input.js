const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: {
    main: "./src/main.js",
  },
  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html", filename: "main.html" })],
};

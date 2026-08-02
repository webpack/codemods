const HtmlWebpackPlugin = require("html-webpack-plugin");
const { DefinePlugin } = require("webpack");

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "[name].js",
  },
  plugins: [
    new HtmlWebpackPlugin(),
    new DefinePlugin({ DEBUG: "false" }),
  ],
};

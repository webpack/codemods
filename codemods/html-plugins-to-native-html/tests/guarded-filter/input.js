const HtmlWebpackPlugin = require("html-webpack-plugin");
const { DefinePlugin } = require("webpack");

const isProd = process.env.NODE_ENV === "production";

module.exports = {
  entry: "./src/index.js",
  plugins: [isProd && new HtmlWebpackPlugin(), new DefinePlugin({ DEBUG: "false" })].filter(Boolean),
};

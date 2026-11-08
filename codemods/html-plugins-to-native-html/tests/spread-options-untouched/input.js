const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = { plugins: [new HtmlWebpackPlugin({ ...options, title: "App" })] };

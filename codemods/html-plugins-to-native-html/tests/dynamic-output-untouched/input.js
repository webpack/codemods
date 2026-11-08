const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = { output: getOutput(), plugins: [new HtmlWebpackPlugin()] };

const HtmlWebpackPlugin = require("html-webpack-plugin");
const { beforeEmit, afterEmit: done } = HtmlWebpackPlugin.getHooks(compilation);
module.exports = { plugins: [new HtmlWebpackPlugin()] };

const HtmlWebpackPlugin = require("html-webpack-plugin");
const other = { beforeEmit: true, beforeAssetTagGeneration: true };
const { beforeEmit } = other;
HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tap("Example", (data) => data);
module.exports = { plugins: [new HtmlWebpackPlugin()] };

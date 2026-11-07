const HtmlWebpackPlugin = require("html-webpack-plugin");
const FaviconsWebpackPlugin = require("favicons-webpack-plugin");

module.exports = { module: { rules: [{ test: /\.html$/, loader: "html-loader" }] }, plugins: [new HtmlWebpackPlugin(), new FaviconsWebpackPlugin({ logo: "./logo.png", favicons: { appName: "App" } })] };

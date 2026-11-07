const HtmlWebpackPlugin = require("html-webpack-plugin");
const FaviconsWebpackPlugin = require("favicons-webpack-plugin");

module.exports = { plugins: [new HtmlWebpackPlugin(), new FaviconsWebpackPlugin({ logo: "./logo.png", favicons: { appName: "App" } })] };

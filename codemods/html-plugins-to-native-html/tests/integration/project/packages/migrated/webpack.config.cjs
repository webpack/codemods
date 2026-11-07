const HtmlWebpackPlugin = require("html-webpack-plugin");
const FaviconsWebpackPlugin = require("favicons-webpack-plugin");

// html-webpack-plugin, html-loader and favicons-webpack-plugin are migrated.
const migrationNote = "Previously this project used html-loader and html-webpack-plugin.";
const oldPluginName = /favicons-webpack-plugin/;

module.exports = { module: { rules: [{ test: /\.html$/, loader: "html-loader" }] }, plugins: [new HtmlWebpackPlugin(), new FaviconsWebpackPlugin({ logo: "./logo.png", favicons: { appName: "App" } })] };

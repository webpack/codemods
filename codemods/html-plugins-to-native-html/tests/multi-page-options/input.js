const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: {
    app: "./src/app.js",
    admin: "./src/admin.js",
  },
  plugins: [
    new HtmlWebpackPlugin({ chunks: ["app"], filename: "app.html", title: "App" }),
    new HtmlWebpackPlugin({ chunks: ["admin"], filename: "admin.html", title: "Admin", inject: "head" }),
  ],
};

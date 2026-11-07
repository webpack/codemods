const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  entry: { app: "./app.js", admin: "./admin.js" },
  plugins: [
    new HtmlWebpackPlugin({ chunks: ["app"], minify: false }),
    new HtmlWebpackPlugin({ chunks: ["admin"], minify: false }),
  ],
};

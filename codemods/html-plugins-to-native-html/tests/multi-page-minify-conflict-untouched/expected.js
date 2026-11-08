const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = {
  entry: { app: "./app.js", admin: "./admin.js" },
  plugins: [
    new HtmlWebpackPlugin({ chunks: ["app"], minify: true }),
    new HtmlWebpackPlugin({ chunks: ["admin"], minify: false }),
  ],
};

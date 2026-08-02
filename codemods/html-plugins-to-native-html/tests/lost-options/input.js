const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: {
    app: "./src/app.js",
    admin: "./src/admin.js",
  },
  plugins: [
    new HtmlWebpackPlugin({
      hash: true,
      minify: { collapseWhitespace: true },
      publicPath: "/static/",
    }),
  ],
};

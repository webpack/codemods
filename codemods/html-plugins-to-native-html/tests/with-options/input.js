const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  plugins: [
    new HtmlWebpackPlugin({
      filename: "app.html",
      title: "My App",
      meta: { viewport: "width=device-width, initial-scale=1" },
      inject: "head",
      scriptLoading: "blocking",
      favicon: "./src/favicon.ico",
      minify: true,
      cache: false,
    }),
  ],
};

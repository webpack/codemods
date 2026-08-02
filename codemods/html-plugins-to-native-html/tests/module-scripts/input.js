const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  plugins: [
    new HtmlWebpackPlugin({
      scriptLoading: "module",
      meta: {
        viewport: "width=device-width, initial-scale=1",
        "og:title": { property: "og:title", content: "My App" },
        refresh: { "http-equiv": "refresh", content: "30" },
      },
    }),
  ],
};

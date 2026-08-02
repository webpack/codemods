const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  output: {
    publicPath: "/app/",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          { loader: MiniCssExtractPlugin.loader, options: { publicPath: "https://cdn.example.com/" } },
          "css-loader",
        ],
      },
      {
        test: /\.module\.css$/,
        use: [
          { loader: MiniCssExtractPlugin.loader, options: { publicPath: "/app/" } },
          "css-loader",
        ],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

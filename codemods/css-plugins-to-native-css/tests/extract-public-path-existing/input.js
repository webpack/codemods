const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          { loader: MiniCssExtractPlugin.loader, options: { publicPath: "https://cdn.example.com/" } },
          "css-loader",
        ],
      },
      { issuer: /\.css$/, generator: { publicPath: "https://cdn.example.com/" } },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

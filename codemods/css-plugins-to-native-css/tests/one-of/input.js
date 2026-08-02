const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        oneOf: [
          {
            test: /\.css$/i,
            use: [MiniCssExtractPlugin.loader, "css-loader"],
          },
          {
            test: /\.js$/,
            use: ["babel-loader"],
          },
        ],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

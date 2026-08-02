const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const devMode = process.env.NODE_ENV !== "production";

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          devMode ? "style-loader" : MiniCssExtractPlugin.loader,
          {
            loader: require.resolve("css-loader"),
            options: { importLoaders: 1 },
          },
        ],
      },
    ],
  },
  plugins: [
    !devMode && new MiniCssExtractPlugin({ filename: "[name].[contenthash].css" }),
  ].filter(Boolean),
};

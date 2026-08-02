const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const isEnvDevelopment = process.env.NODE_ENV === "development";
const isEnvProduction = process.env.NODE_ENV === "production";

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          isEnvDevelopment && require.resolve("style-loader"),
          isEnvProduction && {
            loader: MiniCssExtractPlugin.loader,
            options: { publicPath: "../../" },
          },
          {
            loader: require.resolve("css-loader"),
            options: { importLoaders: 1 },
          },
        ].filter(Boolean),
      },
    ],
  },
  plugins: [
    isEnvProduction &&
      new MiniCssExtractPlugin({
        filename: "static/css/[name].[contenthash:8].css",
        chunkFilename: "static/css/[name].[contenthash:8].chunk.css",
      }),
  ].filter(Boolean),
};

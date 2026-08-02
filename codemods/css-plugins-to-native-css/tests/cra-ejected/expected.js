const isEnvDevelopment = process.env.NODE_ENV === "development";
const isEnvProduction = process.env.NODE_ENV === "production";

module.exports = {
  experiments: {
    css: true,
  },
  output: {
    cssFilename: "static/css/[name].[contenthash:8].css",
    cssChunkFilename: "static/css/[name].[contenthash:8].chunk.css",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        // Removed loader options without a native CSS equivalent: MiniCssExtractPlugin.loader.publicPath
        type: "css/auto",
      },
    ],
  },
};

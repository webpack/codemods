module.exports = {
  experiments: {
    css: true,
  },
  output: {
    publicPath: "/app/",
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

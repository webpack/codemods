module.exports = {
  experiments: {
    css: true,
  },
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        // Removed loader options without a native CSS equivalent: css-loader.sourceMap (scope devtool entries per asset type)
        type: "css/auto",
      },
    ],
  },
};

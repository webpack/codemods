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
        // Removed loader options without a native CSS equivalent: css-loader.sourceMap
        type: "css/auto",
      },
    ],
  },
};

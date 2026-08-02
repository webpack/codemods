module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        // Removed loader options without a native CSS equivalent: css-loader.modules
        type: "css/auto",
      },
    ],
  },
};

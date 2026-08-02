module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        // Removed css-loader options without a native CSS equivalent: url, import
        type: "css/auto",
      },
    ],
  },
};

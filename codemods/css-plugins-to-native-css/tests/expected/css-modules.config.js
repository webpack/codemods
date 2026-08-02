module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        // Removed css-loader options without a native CSS equivalent: modules
        type: "css/auto",
      },
    ],
  },
};

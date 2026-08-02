module.exports = {
  experiments: {
    css: true,
  },
  output: {
    crossOriginLoading: "anonymous",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        // Removed loader options without a native CSS equivalent: style-loader.attributes.nonce
        type: "css/auto",
      },
    ],
  },
};

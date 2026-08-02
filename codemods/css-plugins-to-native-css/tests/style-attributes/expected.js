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
        // Removed loader options without a native CSS equivalent: style-loader.attributes.nonce (set __webpack_nonce__ or output.html.csp.nonce)
        type: "css/auto",
      },
    ],
  },
};

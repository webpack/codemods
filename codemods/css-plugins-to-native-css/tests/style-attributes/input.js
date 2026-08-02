module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [
          { loader: "style-loader", options: { attributes: { crossorigin: "anonymous", nonce: "abc123" } } },
          "css-loader",
        ],
      },
    ],
  },
};

module.exports = {
  module: {
    rules: [
      {
        test: /\.md$/,
        use: [
          {
            loader: "html-loader",
            options: {
              preprocessor: (content) => content,
            },
          },
          "markdown-loader",
        ],
      },
    ],
  },
};

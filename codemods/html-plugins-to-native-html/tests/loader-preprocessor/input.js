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
              postprocessor: (content) => content,
              minimize: { removeComments: true },
            },
          },
          "markdown-loader",
        ],
      },
    ],
  },
};

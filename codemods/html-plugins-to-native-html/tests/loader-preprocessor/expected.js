module.exports = {
  optimization: { minimizeOptions: { html: { comments: false } } },
  module: {
    rules: [
      {
        test: /\.md$/,
        use: ["markdown-loader"],
        type: "html",
        parser: { template: (content) => content },
      },
    ],
  },
};

module.exports = {
  module: {
    rules: [
      {
        test: /\.md$/,
        // Removed loader options without a native HTML equivalent: html-loader.preprocessor (move it to the rule's parser.template — synchronous (source, { module, resource }) => string)
        use: ["markdown-loader"],
        type: "html",
      },
    ],
  },
};

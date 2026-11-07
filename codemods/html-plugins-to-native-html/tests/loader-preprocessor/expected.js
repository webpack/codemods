module.exports = {
  optimization: { minimizeOptions: { html: { comments: false } } },
  module: {
    rules: [
      {
        test: /\.md$/,
        // Removed loader options without a native HTML equivalent: html-loader.preprocessor (move it to the rule's parser.template — synchronous (source, { module, resource }) => string), html-loader.postprocessor (tap HtmlModulesPlugin.getCompilationHooks(compilation).transformHtml for emitted pages)
        use: ["markdown-loader"],
        type: "html",
      },
    ],
  },
};

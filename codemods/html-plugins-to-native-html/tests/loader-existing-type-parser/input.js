module.exports = {
  experiments: { html: false },
  module: {
    rules: [{
      test: /\.html$/,
      type: "javascript/auto",
      parser: { custom: true },
      use: [{ loader: "html-loader", options: { sources: false } }, "template-loader"],
    }],
  },
};

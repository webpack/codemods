module.exports = {
  experiments: { html: true },
  module: {
    rules: [{
      test: /\.html$/,
      parser: { sources: false, custom: true },
      use: ["template-loader"],
      type: "html",
    }],
  },
};

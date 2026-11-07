export default {
  module: {
    rules: [{
      test: /\.html$/,
      use: [{ loader: "html-loader", options: { sources: { list: [{ attribute: "data-src", type: "src" }] } } }, "template-loader"],
      parser: { urlHints: false },
    }],
  },
};

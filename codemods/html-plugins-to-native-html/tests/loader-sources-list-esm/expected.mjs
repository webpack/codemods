export default {
  experiments: {
    html: true,
  },
  module: {
    rules: [{
      test: /\.html$/,
      use: ["template-loader"],
      type: "html",
      parser: { sources: [{ attribute: "data-src", type: "src" }], urlHints: false },
    }],
  },
};

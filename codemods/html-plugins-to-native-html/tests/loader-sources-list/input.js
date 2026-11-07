module.exports = {
  module: {
    rules: [{
      test: /\.html$/,
      loader: "html-loader",
      options: { sources: { list: ["...", { tag: "img", attribute: "data-src", type: "src" }, { tag: "img", attribute: "data-srcset", type: "srcset" }] } },
    }],
  },
};

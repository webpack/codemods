module.exports = {
  experiments: {
    html: true,
  },
  module: {
    parser: { html: { sources: ["..."] } },
    rules: [{
      test: /\.html$/,
      type: "html",
      parser: { sources: ["...", { tag: "img", attribute: "data-src", type: "src" }, { tag: "img", attribute: "data-srcset", type: "srcset" }] },
    }],
  },
};

module.exports = {
  module: {
    parser: { html: { sources: [{ tag: "img", attribute: "custom", type: "src" }], urlHints: false } },
    rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: ["...", { tag: "img", attribute: "data-src", type: "src" }] } } }],
  },
};

module.exports = {
  module: {
    parser: { html: { sources: false, urlHints: false } },
    rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: ["...", { tag: "img", attribute: "data-src", type: "src" }] } } }],
  },
};

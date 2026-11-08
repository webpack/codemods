module.exports = {
  experiments: {
    html: true,
  },
  module: {
    parser: { html: { sources: ["..."], urlHints: false } },
    rules: [{ test: /\.html$/, type: "html", parser: { sources: ["...", { tag: "img", attribute: "data-src", type: "src" }] } }],
  },
};

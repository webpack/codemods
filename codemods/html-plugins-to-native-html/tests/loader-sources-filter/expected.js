module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: [{ tag: "img", attribute: "src", type: "src", filter: (htmlAttributes) => ((tag) => tag !== "img")("img") }] } }] },
};

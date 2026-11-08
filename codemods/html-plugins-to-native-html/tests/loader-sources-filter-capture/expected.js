const htmlAttributes = true;
module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: [{ tag: "img", attribute: "src", type: "src", filter: (htmlAttributes_) => (() => htmlAttributes)() }] } }] },
};

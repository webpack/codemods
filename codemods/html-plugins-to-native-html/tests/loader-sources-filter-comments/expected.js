module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: [{ tag: "img", attribute: "src", type: "src", filter: (htmlAttributes) => ((tag, attribute, attrs) => /* namespace prefix htmlAttributes */ attrs.some((item) => item.name === "data-local"))("img", "src", Array.from(htmlAttributes, ([name, value]) => ({ name, value }))) }] } }] },
};

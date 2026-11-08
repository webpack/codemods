module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: [{ tag: "img", attribute: "src", type: "src", filter: (tag, attribute, attrs) => /* namespace prefix htmlAttributes */ attrs.some((item) => item.name === "data-local") }] } } }] },
};

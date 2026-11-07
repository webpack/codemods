module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: ["...", { tag: "img", attribute: "src", type: "src", filter: (tag, attribute, attrs) => attrs.some((item) => item.name === "data-local" && item.value === "yes") }] } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: [{ tag: "img", attribute: "src", type: "src", filter: (tag, attr, attrs, resource) => resource.endsWith("index.html") }] } } }] },
};

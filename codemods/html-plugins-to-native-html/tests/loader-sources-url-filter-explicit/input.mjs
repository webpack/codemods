export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: [{ tag: "img", attribute: "src", type: "src" }], urlFilter: (attribute, value) => !value.startsWith("/") } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: [{ tag: "img", attribute: "srcset", type: "srcset" }], urlFilter: (attribute, value) => !value.startsWith("/") } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: ["..."], urlFilter: (attribute, value) => !value.startsWith("/") } } }] },
};

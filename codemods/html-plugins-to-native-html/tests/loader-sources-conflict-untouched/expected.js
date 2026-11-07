module.exports = {
  module: { rules: [{ test: /\.html$/, parser: { sources: false }, loader: "html-loader", options: { sources: { list: ["..."] } } }] },
};

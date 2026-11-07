module.exports = {
  module: { rules: [{ test: /\.html$/, parser: getParser(), loader: "html-loader", options: { sources: false } }] },
};

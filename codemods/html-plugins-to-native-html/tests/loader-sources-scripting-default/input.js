module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { scriptingEnabled: true } } }] },
};

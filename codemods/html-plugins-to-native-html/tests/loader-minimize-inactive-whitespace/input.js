module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { minimize: { collapseWhitespace: false, conservativeCollapse: false } } }] },
};

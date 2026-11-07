module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { minimize: { conservativeCollapse: false, collapseWhitespace: true } } }] },
};

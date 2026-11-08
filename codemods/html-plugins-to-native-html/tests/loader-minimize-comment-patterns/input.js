module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { minimize: { removeComments: true, ignoreCustomComments: [/^keep/i, /@license/] } } }] },
};

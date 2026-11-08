module.exports = {
  optimization: { minimizeOptions: { javascript: false } },
  module: { rules: [{ test: /\.html$/, use: [{ loader: "html-loader", options: { minimize: { removeComments: false } } }] }] },
};

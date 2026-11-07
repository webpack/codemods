module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { minimize: { minifyJS: false, minifyCSS: (css) => css } } }] },
};

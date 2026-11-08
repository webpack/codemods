module.exports = {
  module: { rules: [
    { test: /\.html$/, loader: "html-loader", options: { minimize: false } },
    { test: /\.html$/, loader: "html-loader", options: { minimize: true } },
  ] },
};

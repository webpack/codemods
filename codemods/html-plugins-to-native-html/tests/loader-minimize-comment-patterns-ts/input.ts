export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { minimize: { ignoreCustomComments: [/^keep/i], removeComments: true } } }] },
};

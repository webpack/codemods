module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content, context = getContext()) => content } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: async (content) => content } }] },
};

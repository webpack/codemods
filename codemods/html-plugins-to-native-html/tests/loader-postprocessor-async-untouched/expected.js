module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { postprocessor: async (content) => content } }] },
};

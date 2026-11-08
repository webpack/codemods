module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content, context) => `${context.resourcePath}|${context.resourceQuery}|${context.resourceFragment}|${context.context}` } }] },
};

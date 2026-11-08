module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content, context) => {
    const/* keep this comment */result = content.trim();
    return result + context /* original resource */ . resource;
  } } }] },
};

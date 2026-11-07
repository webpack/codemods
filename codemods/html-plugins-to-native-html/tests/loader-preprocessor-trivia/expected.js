module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html",
  parser: { template: (content, context) => {
    const/* keep this comment */result = content.trim();
    return result + context /* original resource */ . resource;
  } } }] },
};

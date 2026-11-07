module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content, context) => content.replace("RESOURCE", context.resource.replace(/^((?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/, "$1").replace(/\0(.)/g, "$1")) } }] },
};

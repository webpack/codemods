module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content, context) => `${context.resource.replace(/^((?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/, "$1").replace(/\0(.)/g, "$1")}|${(context.resource.match(/^((?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/)?.[2]?.replace(/\0(.)/g, "$1") ?? "")}|${(context.resource.match(/^((?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/)?.[3] ?? "")}|${context.module.context}` } }] },
};

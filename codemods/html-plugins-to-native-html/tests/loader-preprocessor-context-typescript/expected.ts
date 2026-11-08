export default {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content: string, context: { addDependency: (dependency: string) => void; resource: string }): string => { context.addDependency("./partial.html"); return content.replace("RESOURCE", context.resource.replace(/^((?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/, "$1").replace(/\0(.)/g, "$1")); } } }] },
};

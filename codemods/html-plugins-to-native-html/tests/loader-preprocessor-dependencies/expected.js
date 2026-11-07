module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content, context) => { context.addDependency("./partial.html"); context.emitWarning(new Error("template warning")); return content.trim(); } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content, context) => { context.addDependency("./partial.html"); context.emitWarning(new Error("template warning")); return content.trim(); } } }] },
};

export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content: string, context: { resourcePath: string; addDependency: (path: string) => void }): string => { context.addDependency("./partial.html"); return content.replace("RESOURCE", context.resourcePath); } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { postprocessor: (content) => content.replace(/title/g, "heading") } }] },
};

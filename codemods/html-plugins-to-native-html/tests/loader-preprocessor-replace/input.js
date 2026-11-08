module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content) => content.replace(/TITLE/g, "App").trim() } }] },
};

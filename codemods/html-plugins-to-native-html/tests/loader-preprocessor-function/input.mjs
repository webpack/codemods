export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: function (content) { const html = content.replace("TITLE", "App"); return html; } } }] },
};

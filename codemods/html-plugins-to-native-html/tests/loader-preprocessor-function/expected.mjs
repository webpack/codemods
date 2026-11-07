export default {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: function (content) { const html = content.replace("TITLE", "App"); return html; } } }] },
};

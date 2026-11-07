module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content) => content.replace(/TITLE/g, "App").trim() } }] },
};

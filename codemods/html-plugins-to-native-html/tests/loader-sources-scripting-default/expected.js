module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: true } }] },
};

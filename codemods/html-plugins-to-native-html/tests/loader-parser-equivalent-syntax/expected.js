module.exports = {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, parser: { sources: [ /* existing */ { attribute: 'src', type: 'src' } ] }, type: "html" }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, parser: { sources: [ /* existing */ { attribute: 'src', type: 'src' } ] }, loader: "html-loader", options: { sources: { list: [{ attribute: "src", type: "src" }] } } }] },
};

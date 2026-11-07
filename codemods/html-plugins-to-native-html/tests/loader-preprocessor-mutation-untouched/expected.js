module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content) => { content = Promise.resolve(content); return content; } } }] },
};

module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: function (content) { return content.replace("VALUE", this.getOptions().value); } } }] },
};

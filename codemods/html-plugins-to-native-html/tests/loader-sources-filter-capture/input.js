const htmlAttributes = true;
module.exports = {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { sources: { list: [{ tag: "img", attribute: "src", type: "src", filter: () => htmlAttributes }] } } }] },
};

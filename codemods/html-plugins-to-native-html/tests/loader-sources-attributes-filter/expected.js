module.exports = {
  experiments: {
    html: true,
  },
  module: { parser: { html: { sources: ["..."] } }, rules: [{ test: /\.html$/, type: "html", parser: { sources: ["...", { tag: "img", attribute: "src", type: "src", filter: (htmlAttributes) => ((tag, attribute, attrs) => attrs.some((item) => item.name === "data-local" && item.value === "yes"))("img", "src", Array.from(htmlAttributes, ([name, value]) => ({ name, value }))) }] } }] },
};

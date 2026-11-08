export default {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: [{ tag: "img", attribute: "src", type: "src", filter: (htmlAttributes, htmlUrl) => ((attribute, value) => !value.startsWith("/"))("src", htmlUrl.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").replace(/^[\u0001-\u0019\u00a0]+|[\u0001-\u0019\u00a0]+$/g, "")) }] } }] },
};

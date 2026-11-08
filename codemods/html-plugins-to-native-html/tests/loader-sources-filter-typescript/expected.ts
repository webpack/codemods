export default {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { sources: [{ tag: "img", attribute: "src", type: "src", filter: (htmlAttributes: Map<string, string>) => ((tag: string) => tag === "img")("img") }] } }] },
};

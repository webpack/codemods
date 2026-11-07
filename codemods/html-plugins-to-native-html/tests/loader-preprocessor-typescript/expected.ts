export default {
  experiments: {
    html: true,
  },
  module: { rules: [{ test: /\.html$/, type: "html", parser: { template: (content: string): string => `<main>${content}</main>` } }] },
};

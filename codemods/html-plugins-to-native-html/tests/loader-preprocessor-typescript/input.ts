export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { preprocessor: (content: string): string => `<main>${content}</main>` } }] },
};

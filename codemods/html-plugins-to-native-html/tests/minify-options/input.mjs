import HtmlWebpackPlugin from "html-webpack-plugin";
export default {
  mode: "development",
  plugins: [new HtmlWebpackPlugin({ minify: {
    collapseWhitespace: false,
    conservativeCollapse: true,
    collapseBooleanAttributes: true,
    removeComments: false,
    removeAttributeQuotes: true,
    removeOptionalTags: false,
    removeEmptyAttributes: true,
    removeRedundantAttributes: false,
    sortAttributes: true,
    minifyJS: false,
    ...extraOptions,
  } })],
};

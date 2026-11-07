import Html from "html-webpack-plugin";
export default [
  { module: { rules: [{ test: /\.html$/, loader: "html-loader", options: { postprocessor: (html) => html.replace(/App/g, "Title") } }] }, plugins: [new Html()] },
  { output: {
  html: true,
  htmlFilename: "index.html",
}, experiments: {
  html: true,
}, },
];

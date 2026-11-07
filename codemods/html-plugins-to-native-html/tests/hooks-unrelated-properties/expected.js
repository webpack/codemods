const { html } = require("webpack");
const other = { beforeEmit: true, beforeAssetTagGeneration: true };
const { beforeEmit } = other;
html.HtmlModulesPlugin.getCompilationHooks(compilation).transformHtml.tap("Example", (data) => data); /* Review: transformHtml receives (html, { outputName }) and must return the html string */
module.exports = { output: {
  html: true,
  htmlFilename: "index.html",
}, experiments: {
  html: true,
}, };

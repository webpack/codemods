const { html } = require("webpack");
// Review: transformHtml receives (html, { outputName }) and must return the html string
// Review: htmlEmitted receives ({ outputName }); nothing to return
const { transformHtml: beforeEmit, htmlEmitted: done } = html.HtmlModulesPlugin.getCompilationHooks(compilation);
module.exports = { output: {
  html: true,
  htmlFilename: "index.html",
}, experiments: {
  html: true,
}, };

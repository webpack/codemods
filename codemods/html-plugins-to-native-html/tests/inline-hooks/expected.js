const { html } = require("webpack");
class Plugin { apply(compiler) { compiler.hooks.compilation.tap("Plugin", c => { html.HtmlModulesPlugin.getCompilationHooks(c).transformHtml.tap("Plugin", data => data); /* Review: transformHtml receives (html, { outputName }) and must return the html string */ }); } }
module.exports = { output: {
  html: true,
  htmlFilename: "index.html",
}, experiments: {
  html: true,
}, plugins: [new Plugin()] };

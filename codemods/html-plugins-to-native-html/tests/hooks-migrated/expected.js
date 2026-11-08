const { html } = require("webpack");

class MyPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap("MyPlugin", (compilation) => {
      html.HtmlModulesPlugin.getCompilationHooks(compilation).transformHtml.tapAsync("MyPlugin", (data, callback) => callback(null, data)); /* Review: transformHtml receives (html, { outputName }) and must return the html string */
    });
  }
}

module.exports = {
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  plugins: [new MyPlugin()],
};

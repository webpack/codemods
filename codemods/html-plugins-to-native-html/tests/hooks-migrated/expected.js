const { html } = require("webpack");

class MyPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap("MyPlugin", (compilation) => {
      // Review: transformHtml receives (html, { outputName }) and must return the html string
      html.HtmlModulesPlugin.getCompilationHooks(compilation).transformHtml.tapAsync("MyPlugin", (data, callback) => callback(null, data));
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

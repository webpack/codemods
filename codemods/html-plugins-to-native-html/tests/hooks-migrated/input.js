const HtmlWebpackPlugin = require("html-webpack-plugin");

class MyPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap("MyPlugin", (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync("MyPlugin", (data, callback) => callback(null, data));
    });
  }
}

module.exports = {
  plugins: [new HtmlWebpackPlugin(), new MyPlugin()],
};

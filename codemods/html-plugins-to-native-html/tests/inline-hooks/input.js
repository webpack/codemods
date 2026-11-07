const HtmlWebpackPlugin = require("html-webpack-plugin");
class Plugin { apply(compiler) { compiler.hooks.compilation.tap("Plugin", c => { HtmlWebpackPlugin.getHooks(c).beforeEmit.tap("Plugin", data => data); }); } }
module.exports = { plugins: [new HtmlWebpackPlugin(), new Plugin()] };

const { DefinePlugin } = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CspHtmlWebpackPlugin = require("csp-html-webpack-plugin");
const { SubresourceIntegrityPlugin } = require("webpack-subresource-integrity");

module.exports = {
  entry: "./src/index.js",
  plugins: [
    new HtmlWebpackPlugin({ title: "App" }),
    new CspHtmlWebpackPlugin({ "script-src": ["'self'"] }),
    new SubresourceIntegrityPlugin({ hashFuncNames: ["sha384"] }),
    new DefinePlugin({ DEBUG: "false" }),
  ],
};

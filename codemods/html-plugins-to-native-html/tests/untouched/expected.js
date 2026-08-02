const { DefinePlugin } = require("webpack");

module.exports = {
  module: {
    rules: [{ test: /\.js$/, use: ["babel-loader"] }],
  },
  plugins: [new DefinePlugin({ DEBUG: "false" })],
};

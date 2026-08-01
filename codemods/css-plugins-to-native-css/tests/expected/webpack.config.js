const path = require("path");
const { DefinePlugin } = require("webpack");

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: ["babel-loader"],
      },
    ],
  },
  plugins: [
    new DefinePlugin({ DEBUG: "false" }),
  ],
};

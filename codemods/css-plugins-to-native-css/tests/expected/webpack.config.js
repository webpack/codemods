const path = require("path");
const { DefinePlugin } = require("webpack");

module.exports = {
  experiments: {
    css: true,
  },
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
      },
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

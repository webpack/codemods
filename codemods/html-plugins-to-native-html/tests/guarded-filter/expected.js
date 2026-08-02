const { DefinePlugin } = require("webpack");

const isProd = process.env.NODE_ENV === "production";

module.exports = {
  output: {
    html: true,
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
  plugins: [new DefinePlugin({ DEBUG: "false" })].filter(Boolean),
};

const { defineConfig } = require("webpack");

module.exports = defineConfig({
  experiments: {
    css: true,
  },
  output: {
    cssFilename: "[name].css",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        type: "css/auto",
      },
    ],
  },
});

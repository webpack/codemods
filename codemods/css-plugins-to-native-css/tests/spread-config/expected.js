const base = require("./webpack.base.js");

module.exports = {
  ...base,
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        type: "css/auto",
      },
    ],
  },
  experiments: {
    css: true,
  },
  output: {
    cssFilename: "[name].css",
  },
};

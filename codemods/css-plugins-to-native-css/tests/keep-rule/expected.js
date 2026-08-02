const path = require("path");

module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: path.resolve(__dirname, "src"),
        type: "css/auto",
      },
    ],
  },
};

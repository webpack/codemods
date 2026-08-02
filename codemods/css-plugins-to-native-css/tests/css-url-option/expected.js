module.exports = {
  experiments: {
    css: true,
  },
  devtool: [{ type: "javascript", use: "source-map" }],
  module: {
    rules: [
      {
        test: /\.css$/,
        type: "css/auto",
        parser: { url: false, import: false },
      },
    ],
  },
};

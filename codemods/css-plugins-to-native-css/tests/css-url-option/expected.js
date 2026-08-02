module.exports = {
  experiments: {
    css: true,
  },
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

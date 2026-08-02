module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["my-custom-loader"],
        type: "css/auto",
      },
    ],
  },
};

module.exports = {
  experiments: {
    css: true,
  },
  target: "node",
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        type: "css/auto",
        generator: { exportsOnly: true },
      },
    ],
  },
};

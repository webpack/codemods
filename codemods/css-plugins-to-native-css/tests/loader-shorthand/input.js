module.exports = {
  target: "node",
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        loader: "css-loader",
        options: { modules: { exportOnlyLocals: true } },
      },
    ],
  },
};

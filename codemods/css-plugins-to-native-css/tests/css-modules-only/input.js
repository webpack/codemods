module.exports = {
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        use: ["style-loader", { loader: "css-loader", options: { modules: true } }],
      },
    ],
  },
};

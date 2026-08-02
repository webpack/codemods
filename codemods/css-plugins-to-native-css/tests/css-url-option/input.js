module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", { loader: "css-loader", options: { url: false, import: false } }],
      },
    ],
  },
};

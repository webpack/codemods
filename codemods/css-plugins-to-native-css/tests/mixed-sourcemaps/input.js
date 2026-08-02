module.exports = {
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: ["style-loader", { loader: "css-loader", options: { sourceMap: false } }],
      },
      {
        test: /\.module\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};

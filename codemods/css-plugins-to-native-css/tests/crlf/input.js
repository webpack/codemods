module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "postcss-loader",
            options: { postcssOptions: {} },
          },
        ],
      },
    ],
  },
};

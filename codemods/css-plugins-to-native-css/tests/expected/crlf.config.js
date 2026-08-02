module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [{
            loader: "postcss-loader",
            options: { postcssOptions: {} },
          }],
        type: "css/auto",
      },
    ],
  },
};

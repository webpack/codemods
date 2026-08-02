const isDev = process.env.NODE_ENV !== "production";

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          isDev && "style-loader",
          "css-loader",
          isDev && "postcss-loader",
        ].filter((loader) => !!loader),
      },
    ],
  },
};

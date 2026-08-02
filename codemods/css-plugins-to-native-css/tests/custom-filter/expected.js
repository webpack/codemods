const isDev = process.env.NODE_ENV !== "production";

module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [isDev && "postcss-loader"].filter((loader) => !!loader),
        type: "css/auto",
      },
    ],
  },
};

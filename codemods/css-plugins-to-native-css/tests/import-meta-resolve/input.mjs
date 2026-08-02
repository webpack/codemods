export default {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [import.meta.resolve("style-loader"), import.meta.resolve("css-loader")],
      },
    ],
  },
};

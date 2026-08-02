export default {
  entry: "./src/index.js",
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", { loader: "css-loader", options: { importLoaders: 1 } }],
      },
    ],
  },
  experiments: {
    outputModule: true,
  },
};

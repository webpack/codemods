export default {
  entry: "./src/index.js",
  module: {
    rules: [
      {
        test: /\.css$/,
        type: "css/auto",
      },
    ],
  },
  experiments: {
    css: true,
    outputModule: true,
  },
};

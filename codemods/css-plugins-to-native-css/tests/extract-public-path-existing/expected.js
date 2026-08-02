module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        type: "css/auto",
      },
      { issuer: /\.css$/, generator: { publicPath: "https://cdn.example.com/" } },
    ],
  },
};

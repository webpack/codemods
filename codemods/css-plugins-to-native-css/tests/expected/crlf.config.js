module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        type: "css/auto",
      },
    ],
  },
};

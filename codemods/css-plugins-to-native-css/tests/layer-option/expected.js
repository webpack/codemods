module.exports = {
  experiments: {
    css: true,
    layers: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        type: "css/auto",
        layer: "styles",
      },
    ],
  },
};

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
        generator: { exportsOnly: true },
        parser: { exportType: "css-style-sheet" },
      },
      {
        test: /\.module\.css$/,
        type: "css/global",
      },
    ],
  },
};

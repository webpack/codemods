module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};

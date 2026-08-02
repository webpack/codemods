module.exports = {
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: ["sass-loader"],
        type: "css/auto",
      },
    ],
  },
};

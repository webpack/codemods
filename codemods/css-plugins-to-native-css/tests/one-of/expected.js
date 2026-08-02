module.exports = {
  module: {
    rules: [
      {
        oneOf: [
          {
            test: /\.js$/,
            use: ["babel-loader"],
          },
        ],
      },
    ],
  },
};

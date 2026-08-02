module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [require("mini-css-extract-plugin").loader, "css-loader"],
      },
    ],
  },
};

const CssExtract = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [CssExtract.loader, "css-loader"],
      },
    ],
  },
  plugins: [new CssExtract({ filename: "[name].css" })],
};

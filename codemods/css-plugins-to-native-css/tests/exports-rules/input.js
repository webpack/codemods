const MiniCssExtractPlugin = require("mini-css-extract-plugin");

exports.cssRules = [
  {
    test: /\.css$/,
    use: [MiniCssExtractPlugin.loader, "css-loader"],
  },
];

const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  experiments: {
    layers: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [{ loader: MiniCssExtractPlugin.loader, options: { layer: "styles" } }, "css-loader"],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

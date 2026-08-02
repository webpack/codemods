import MiniCssExtractPlugin from "mini-css-extract-plugin";
import type { Configuration } from "webpack";

const config: Configuration = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

export default config;

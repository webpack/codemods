import HtmlWebpackPlugin from "html-webpack-plugin";
import type { Configuration } from "webpack";

const config: Configuration = {
  entry: "./src/index.js",
  plugins: [new HtmlWebpackPlugin({ title: "App" })],
};

export default config;

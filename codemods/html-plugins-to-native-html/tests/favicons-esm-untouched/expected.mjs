import Html from "html-webpack-plugin";
import Icons from "favicons-webpack-plugin";
export default {
  module: { rules: [{ test: /\.html$/, loader: "html-loader" }] },
  plugins: [new Html(), new Icons({ logo: "./logo.png", favicons: { appName: "App" } })],
};

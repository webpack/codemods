const mapsSetting = process.env.CI ? "source-map" : "eval";

module.exports = {
  devtool: mapsSetting,
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", { loader: "css-loader", options: { sourceMap: false } }],
      },
    ],
  },
};

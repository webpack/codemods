const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        include: "src",
        use: [
          { loader: MiniCssExtractPlugin.loader, options: { emit: false } },
          { loader: "css-loader", options: { exportType: "css-style-sheet" } },
        ],
      },
      {
        test: /\.module\.css$/,
        use: ["style-loader", { loader: "css-loader", options: { modules: { mode: "global" } } }],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin()],
};

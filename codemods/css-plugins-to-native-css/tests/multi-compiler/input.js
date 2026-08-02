const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = [
  {
    name: "web",
    entry: "./src/index.js",
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
      ],
    },
    plugins: [new MiniCssExtractPlugin({ filename: "web/[name].css" })],
  },
  {
    name: "ssr",
    target: "node",
    entry: "./src/server.js",
    module: {
      rules: [
        {
          test: /\.css$/,
          include: "src",
          use: ["style-loader", "css-loader"],
        },
      ],
    },
  },
];

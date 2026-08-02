const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    if (!isServer) {
      config.plugins.push(new MiniCssExtractPlugin({ filename: "static/css/[name].css" }));
      config.module.rules.push({
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      });
      config.module.rules = [
        ...config.module.rules,
        {
          test: /\.scss$/,
          use: ["style-loader", "css-loader", "sass-loader"],
        },
      ];
    }
    return config;
  },
};

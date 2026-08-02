module.exports = {
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              sourceMap: true,
              modules: {
                auto: true,
                localIdentName: "[name]__[local]___[hash:base64:5]",
                localIdentHashSalt: "app-styles",
                exportOnlyLocals: false,
                namedExport: true,
                exportLocalsConvention: "camelCase",
                mode: "local",
              },
            },
          },
        ],
      },
    ],
  },
};

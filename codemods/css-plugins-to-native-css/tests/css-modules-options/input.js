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
              modules: {
                localIdentName: "[name]__[local]___[hash:base64:5]",
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

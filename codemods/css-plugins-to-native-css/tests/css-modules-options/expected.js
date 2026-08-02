module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        type: "css/auto",
        generator: { localIdentName: "[name]__[local]___[hash:base64:5]", localIdentHashSalt: "app-styles", exportsOnly: false, exportsConvention: "camel-case" },
        parser: { namedExports: true },
      },
    ],
  },
};

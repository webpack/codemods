module.exports = {
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        // Removed loader options without a native CSS equivalent: css-loader.modules.mode
        type: "css/auto",
        generator: { localIdentName: "[name]__[local]___[hash:base64:5]", localIdentHashSalt: "app-styles", exportsOnly: false, exportsConvention: "camel-case" },
        parser: { namedExports: true },
      },
    ],
  },
};

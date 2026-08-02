const MiniCssExtractPlugin = require("mini-css-extract-plugin");

class IntegrityPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("IntegrityPlugin", (compilation) => {
      const hooks = MiniCssExtractPlugin.getCompilationHooks(compilation);
      hooks.beforeTagInsert.tap("IntegrityPlugin", (source) => source);
      hooks.linkPreload.tap("IntegrityPlugin", (source) => source);
    });
  }
}

module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin(), new IntegrityPlugin()],
};

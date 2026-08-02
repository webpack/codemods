import MiniCssExtractPlugin from "mini-css-extract-plugin";

class IntegrityPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("IntegrityPlugin", (compilation) => {
      const { beforeTagInsert } = MiniCssExtractPlugin.getCompilationHooks(compilation);
      beforeTagInsert.tap("IntegrityPlugin", (source) => source);
    });
  }
}

export default {
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

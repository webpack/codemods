import { web } from "webpack";

class IntegrityPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("IntegrityPlugin", (compilation) => {
      const { linkInsert: beforeTagInsert } = web.CssLoadingRuntimeModule.getCompilationHooks(compilation);
      beforeTagInsert.tap("IntegrityPlugin", (source) => source);
    });
  }
}

export default {
  plugins: [new IntegrityPlugin()],
};

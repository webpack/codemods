const { web } = require("webpack");

class IntegrityPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("IntegrityPlugin", (compilation) => {
      const hooks = web.CssLoadingRuntimeModule.getCompilationHooks(compilation);
      hooks.linkInsert.tap("IntegrityPlugin", (source) => source);
      hooks.linkPreload.tap("IntegrityPlugin", (source) => source);
    });
  }
}

module.exports = {
  plugins: [new IntegrityPlugin()],
};

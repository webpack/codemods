const { DefinePlugin } = require("webpack");

module.exports = {
  output: {
    html: { title: "App", csp: { policy: { "script-src": ["'self'"] } }, integrity: ["sha384"], favicon: "./src/logo.png" },
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
  plugins: [
    new DefinePlugin({ DEBUG: "false" }),
  ],
};

const { DefinePlugin } = require("webpack");

module.exports = {
  output: {
    // Review: native favicon emits the source icon only; generate the required icon sizes/formats and web app manifest manually, then configure their links in output.html or the HTML template
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

module.exports = {
  entry: "./src/index.js",
  plugins: [new (require("html-webpack-plugin"))({ title: "App" })],
};

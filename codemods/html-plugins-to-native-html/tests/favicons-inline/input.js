module.exports = {
  plugins: [new (require("html-webpack-plugin"))(), new (require("favicons-webpack-plugin"))("./logo.png")],
};

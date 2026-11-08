module.exports = (require) => ({
  optimization: { minimizer: [new (require("css-minimizer-webpack-plugin"))()] },
});

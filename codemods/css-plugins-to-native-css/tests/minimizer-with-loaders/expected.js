
module.exports = {
  output: {
    cssFilename: "[name].css",
  },
  optimization: { minimizeOptions: { css: { comments: /^!/, extractComments: false } }, minimizer: ["..."] },
};

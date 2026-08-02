const devMode = process.env.NODE_ENV !== "production";

module.exports = {
  output: {
    cssFilename: "[name].[contenthash].css",
  },
};

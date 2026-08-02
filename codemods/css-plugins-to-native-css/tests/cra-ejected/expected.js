const isEnvDevelopment = process.env.NODE_ENV === "development";
const isEnvProduction = process.env.NODE_ENV === "production";

module.exports = {
  output: {
    cssFilename: "static/css/[name].[contenthash:8].css",
    cssChunkFilename: "static/css/[name].[contenthash:8].chunk.css",
  },
};

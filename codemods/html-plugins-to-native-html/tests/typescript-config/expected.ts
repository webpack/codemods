import type { Configuration } from "webpack";

const config: Configuration = {
  output: {
    html: { title: "App" },
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
  entry: "./src/index.js",
};

export default config;

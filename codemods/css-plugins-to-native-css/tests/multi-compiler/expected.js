module.exports = [
  {
    output: {
      cssFilename: "web/[name].css",
    },
    name: "web",
    entry: "./src/index.js",
  },
  {
    experiments: {
      css: true,
    },
    name: "ssr",
    target: "node",
    entry: "./src/server.js",
    module: {
      rules: [
        {
          test: /\.css$/,
          include: "src",
          type: "css/auto",
        },
      ],
    },
  },
];

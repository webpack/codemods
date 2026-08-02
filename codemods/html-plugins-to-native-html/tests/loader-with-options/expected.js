module.exports = {
  experiments: {
    html: true,
  },
  module: {
    rules: [
      {
        test: /\.html$/i,
        type: "html",
        parser: { sources: false },
      },
    ],
  },
};

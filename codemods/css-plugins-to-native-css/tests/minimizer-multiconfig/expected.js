module.exports = [
  { optimization: { minimizeOptions: { css: { comments: false, extractComments: false } }, minimizer: ["..."] } },
  { optimization: { minimizeOptions: { css: { comments: true, extractComments: false } }, minimizer: ["..."] } },
];

module.exports = {
  optimization: { minimizeOptions: { html: { comments: (comment) => [/^keep/i, /@license/].some((pattern) => pattern.test(comment)), extractComments: false } } },
};

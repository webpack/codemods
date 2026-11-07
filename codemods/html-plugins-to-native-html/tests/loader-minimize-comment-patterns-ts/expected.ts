export default {
  optimization: { minimizeOptions: { html: { comments: (comment: string) => [/^keep/i].some((pattern) => pattern.test(comment)), extractComments: false } } },
};

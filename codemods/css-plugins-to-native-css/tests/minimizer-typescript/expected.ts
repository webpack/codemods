import type { Configuration } from "webpack";

export default {
  optimization: {
    minimizeOptions: { css: { comments: true, extractComments: false } },
    minimizer: ["..."],
  },
} satisfies Configuration;

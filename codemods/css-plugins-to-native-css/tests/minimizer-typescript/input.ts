import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import type { Configuration } from "webpack";

export default {
  optimization: {
    minimizer: ["...", new CssMinimizerPlugin({ minimizerOptions: { preset: ["default", { discardComments: false }] } })],
  },
} satisfies Configuration;

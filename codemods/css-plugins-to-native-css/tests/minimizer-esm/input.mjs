import MinifyCss from "css-minimizer-webpack-plugin";

export default {
  optimization: {
    minimizer: ["...", new MinifyCss({ minimizerOptions: { preset: ["default", { discardComments: false }] } })],
  },
};

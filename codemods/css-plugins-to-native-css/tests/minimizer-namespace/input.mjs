import * as CssMinimizer from "css-minimizer-webpack-plugin";

export default { optimization: { minimizer: ["...", new CssMinimizer.default()] } };

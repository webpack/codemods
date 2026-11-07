import Html from "html-webpack-plugin";
export default {
  experiments: { outputModule: true },
  plugins: [new Html({ scriptLoading: "module" })],
};

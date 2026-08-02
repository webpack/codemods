const mapsSetting = process.env.CI ? "source-map" : "eval";

module.exports = {
  devtool: [{ type: "javascript", use: mapsSetting }, { type: "css", use: false }],
};

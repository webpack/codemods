module.exports = {
  output: {
    htmlFilename: "[name].html",
  },
  experiments: {
    html: true,
  },
  entry: {
    app: { import: "./src/app.js", html: { title: "App" } },
    admin: { import: "./src/admin.js", html: { title: "Admin", inject: "head" } },
  },
};

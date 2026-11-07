export default {
  output: {
    // Review: native favicon emits the source icon only; generate the required icon sizes/formats and web app manifest manually, then configure their links in output.html or the HTML template
    // Removed favicon generator options without a native HTML equivalent: favicons
    html: { favicon: "./logo.png" },
    htmlFilename: "index.html",
  },
  experiments: {
    html: true,
  },
};

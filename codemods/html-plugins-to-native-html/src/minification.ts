import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { ConfigEditor, findPair, keyName, namedChildren, unquote } from "@webpack/codemod-utils";

export interface Minification {
  // null uses webpack's production default; false disables only HTML.
  html: string | null;
  lost: string[];
}

const BOOLEAN_OPTIONS = new Set([
  "collapseBooleanAttributes",
  "collapseWhitespace",
  "minifyConditionalComments",
  "removeEmptyAttributes",
  "removeEmptyElements",
  "removeRedundantAttributes",
  "sortAttributes",
]);

// html-minifier-terser and webpack do not accept the same option object.
// Only translate known literal values; retain a review note for everything else.
export function collectMinification(value: SgNode<Js> | null | undefined, name: string): Minification {
  const result: Minification = { html: null, lost: [] };
  if (!value || value.is("true") || (value.is("string") && unquote(value.text()) === "auto")) {
    return result;
  }
  if (value.is("false")) return { html: "false", lost: [] };
  if (!value.is("object")) {
    result.lost.push(`${name} (configure optimization.minimizeOptions.html)`);
    return result;
  }
  const props = new Map<string, string>();
  const removeComments = findPair(value, "removeComments")?.field("value");
  const ignoredComments = findPair(value, "ignoreCustomComments")?.field("value");
  for (const child of namedChildren(value)) {
    if (child.is("comment")) continue;
    const key = keyName(child);
    const option = child.field("value");
    if (key === "ignoreCustomComments" && option) {
      if (removeComments?.is("false")) continue;
      const patterns = option.is("array") ? namedChildren(option).filter((node) => !node.is("comment")) : null;
      if (!patterns || patterns.some((node) => !node.is("regex"))) {
        result.lost.push(`${name}.${key} (configure optimization.minimizeOptions.html.comments)`);
      }
      continue;
    }
    if (!key || !option || (!option.is("true") && !option.is("false"))) {
      result.lost.push(`${name}.${key ?? "options"} (configure optimization.minimizeOptions.html)`);
      continue;
    }
    const enabled = option.is("true");
    if (BOOLEAN_OPTIONS.has(key)) {
      props.set(key, option.text());
    } else if (key === "removeComments") {
      props.set("comments", enabled ? "false" : "true");
      // Keeping a comment in the HTML also means not moving it to LICENSE.txt.
      if (!enabled) props.set("extractComments", "false");
    } else if (key === "removeAttributeQuotes") {
      props.set("normalizeAttributeQuotes", option.text());
    } else if (key === "removeOptionalTags") {
      props.set("removeOptionalTags", option.text());
      props.set("removeImpliedTags", option.text());
    } else if (key === "conservativeCollapse") {
      // Applied below after collapseWhitespace so source key order is irrelevant.
    } else {
      result.lost.push(`${name}.${key} (configure optimization.minimizeOptions.html)`);
    }
  }
  if (props.get("collapseWhitespace") === "true" && findPair(value, "conservativeCollapse")?.field("value")?.is("false")) {
    props.set("collapseWhitespace", '"all"');
  }
  if (ignoredComments?.is("array") && removeComments?.is("true")) {
    const patterns = namedChildren(ignoredComments).filter((node) => !node.is("comment"));
    if (patterns.every((node) => node.is("regex"))) {
      const parameter = /\.[cm]?tsx?$/.test(value.getRoot().filename()) ? "comment: string" : "comment";
      props.set("comments", patterns.length ? `(${parameter}) => [${patterns.map((node) => node.text()).join(", ")}].some((pattern) => pattern.test(comment))` : "false");
      props.set("extractComments", "false");
    }
  }
  if (props.size) {
    result.html = `{ ${[...props].map(([key, text]) => `${key}: ${text}`).join(", ")} }`;
  }
  return result;
}

// Keep the build's mode and minimize switch: using `minimize: { html: ... }`
// would also turn JavaScript/CSS minimization on in development.
export function planMinification(
  editor: ConfigEditor,
  config: SgNode<Js>,
  requests: Minification[],
  notes: string[],
): string | null {
  if (!requests.length) return null;
  const values = new Set(requests.map((request) => request.html ?? "{}"));
  let html = requests.find((request) => request.html !== null)?.html ?? null;
  if (values.size > 1) {
    notes.push("Review: HTML minification differs between pages or loaders; configure optimization.minimizeOptions.html for the whole compilation");
    html = null;
  }
  const optimization = findPair(config, "optimization")?.field("value");
  if (!optimization) {
    return html === null ? null : `optimization: { minimizeOptions: { html: ${html} } }`;
  }
  if (!optimization.is("object")) {
    notes.push("Review: configure the existing optimization value to use webpack's native HTML minimizer (minimizeOptions.html and minimizer: [\"...\"])");
    return null;
  }
  const minimizer = findPair(optimization, "minimizer")?.field("value");
  if (minimizer?.is("array") && html !== "false") {
    const elements = namedChildren(minimizer).filter((element) => !element.is("comment"));
    if (!elements.some((element) => element.is("string") && unquote(element.text()) === "...")) {
      // Append after custom minimizers, so assets they marked minimized stay so.
      const end = elements.at(-1)?.range().end.index ?? minimizer.range().start.index + 1;
      editor.addEdit({
        startPos: end,
        endPos: end,
        insertedText: `${elements.length ? "," : ""} "..."`,
      });
    }
  } else if (minimizer && !minimizer.is("array")) {
    notes.push('Review: keep "..." in optimization.minimizer to enable native HTML minification');
  }
  if (html === null) return null;
  const minimize = findPair(optimization, "minimize")?.field("value");
  const separateOptions = findPair(optimization, "minimizeOptions")?.field("value");
  // The shorthand takes precedence during webpack normalization.
  const options = minimize?.is("object") ? minimize : separateOptions;
  if (options?.is("object")) {
    if (!findPair(options, "html")) {
      editor.insertIntoObject(options, () => [`html: ${html}`]);
    } else {
      notes.push("Review: existing native HTML minification options take precedence over migrated minify/minimize options");
    }
  } else if (options) {
    notes.push("Review: merge the HTML minification options into the existing optimization.minimizeOptions value");
  } else {
    editor.insertIntoObject(optimization, () => [`minimizeOptions: { html: ${html} }`]);
  }
  return null;
}

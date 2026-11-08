import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { namedChildren, staticString } from "@webpack/codemod-utils";

export type NativeCssOptions = Map<string, string>;

// A native switch can cover several cssnano passes. Disabling any of those
// passes disables the whole group, even if another pass is explicitly enabled.
const TRANSFORMS = new Map<string, string[]>([
  ["colormin", ["shortenColors"]],
  ["mergeLonghand", ["mergeLonghands"]],
  ["mergeRules", ["mergeRules"]],
  ["discardDuplicates", ["removeDeadRules"]],
  ["discardEmpty", ["removeDeadRules"]],
  ["discardOverridden", ["removeDeadRules"]],
  ["normalizeString", ["normalizeQuotes"]],
  ["normalizeUrl", ["normalizeQuotes"]],
  ["calc", ["reduceFunctions"]],
  ["minifyGradients", ["reduceFunctions"]],
  ["reduceTransforms", ["reduceFunctions"]],
  ["normalizeTimingFunctions", ["reduceFunctions"]],
  ["minifySelectors", ["shortenSelectors"]],
  ["uniqueSelectors", ["shortenSelectors"]],
  ["minifyParams", ["shortenMediaQueries"]],
  ["reduceInitial", ["shortenValues"]],
  ["minifyFontValues", ["shortenValues"]],
  ["orderedValues", ["shortenValues"]],
  ["normalizeDisplayValues", ["shortenValues"]],
  ["normalizePositions", ["shortenValues"]],
  ["normalizeRepeatStyle", ["shortenValues"]],
  ["cssDeclarationSorter", ["reorderDeclarations"]],
  ["merge", ["mergeLonghands", "mergeRules", "removeDeadRules"]],
]);

// Spreads, getters, computed keys and duplicate keys need runtime evaluation.
// Reject the whole object rather than silently discard an option.
export function literalProperties(node: SgNode<Js>): Map<string, SgNode<Js>> | null {
  if (!node.is("object")) {
    return null;
  }

  const properties = new Map<string, SgNode<Js>>();

  for (const child of namedChildren(node)) {
    if (child.is("comment")) {
      continue;
    }

    const key = child.field("key");
    const value = child.field("value");
    const name = key?.is("property_identifier") ? key.text() : staticString(key);

    if (!child.is("pair") || name === null || !value || properties.has(name)) {
      return null;
    }

    properties.set(name, value);
  }

  return properties;
}

function enabledOption(node: SgNode<Js>): boolean | null {
  if (node.is("true") || node.is("false")) {
    return node.is("true");
  }

  const properties = literalProperties(node);

  if (!properties) {
    return null;
  }

  if (!properties.size) {
    return true;
  }

  const exclude = properties.get("exclude");

  return properties.size === 1 && (exclude?.is("true") || exclude?.is("false"))
    ? exclude.is("false")
    : null;
}

function setTransform(options: NativeCssOptions, name: string, enabled: boolean): void {
  if (options.get(name) !== "false") {
    options.set(name, String(enabled));
  }

  if (name === "mergeRules" && !enabled) {
    options.set("mergeDistantRules", "false");
  }
}

function translateComments(node: SgNode<Js>, options: NativeCssOptions): boolean {
  const enabled = enabledOption(node);

  if (enabled !== null) {
    options.set("comments", enabled ? "/^!/" : "true");

    return true;
  }

  const properties = literalProperties(node);

  if (!properties) {
    return false;
  }

  for (const [name, value] of properties) {
    if (name === "removeAll" && (value.is("true") || value.is("false"))) {
      continue;
    }

    if (name === "removeAllButFirst" && value.is("false")) {
      continue;
    }

    return false;
  }

  options.set("comments", properties.get("removeAll")?.is("true") ? "false" : "/^!/");

  return true;
}

function translateConversions(node: SgNode<Js>, options: NativeCssOptions): boolean {
  const enabled = enabledOption(node);

  if (enabled !== null) {
    setTransform(options, "shortenNumbers", enabled);
    options.set("convertLengthUnits", "false");

    return true;
  }

  const properties = literalProperties(node);
  const length = properties?.get("length");

  if (properties?.size !== 1 || (!length?.is("true") && !length?.is("false"))) {
    return false;
  }

  options.set("convertLengthUnits", length.text());

  return true;
}

function translatePreset(node: SgNode<Js>, options: NativeCssOptions): boolean {
  const properties = literalProperties(node);

  if (!properties) {
    return false;
  }

  for (const [name, value] of properties) {
    if (name === "discardComments") {
      if (!translateComments(value, options)) {
        return false;
      }

      continue;
    }

    if (name === "convertValues") {
      if (!translateConversions(value, options)) {
        return false;
      }

      continue;
    }

    // cssnano's combined merge pass also allows just rule merging to be off.
    if (name === "merge" && value.is("object")) {
      const merge = literalProperties(value);
      const rules = merge?.get("rules");

      if (merge?.size === 1 && (rules?.is("true") || rules?.is("false"))) {
        setTransform(options, "mergeRules", rules.is("true"));

        continue;
      }
    }

    const enabled = enabledOption(value);
    const transforms = TRANSFORMS.get(name);

    if (!transforms || enabled === null) {
      return false;
    }

    for (const transform of transforms) {
      setTransform(options, transform, enabled);
    }
  }

  return true;
}

export function cssnanoOptions(value?: SgNode<Js>): NativeCssOptions | null {
  // cssnano keeps /*! comments in the CSS, without extracting a LICENSE file.
  const options: NativeCssOptions = new Map([
    ["comments", "/^!/"],
    ["extractComments", "false"],
  ]);

  if (!value) {
    return options;
  }

  const properties = literalProperties(value);
  const preset = properties?.get("preset");

  // Without an explicit preset, cssnano may load an external config file.
  if (properties?.size !== 1 || !preset) {
    return null;
  }

  if (staticString(preset) === "default") {
    return options;
  }

  if (!preset.is("array")) {
    return null;
  }

  const entries = namedChildren(preset).filter((node) => !node.is("comment"));

  if (staticString(entries[0]) !== "default" || entries.length > 2) {
    return null;
  }

  return entries.length === 1 || translatePreset(entries[1], options) ? options : null;
}

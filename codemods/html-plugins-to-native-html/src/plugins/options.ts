import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, keyName, pairsOf, unquote } from "@webpack/codemod-utils";
import { collectMinification, type Minification } from "../minification";
import type { HtmlProp } from "../config-plan";

// Native HTML defaults already covered by these plugin option values.
const HEAD_TAG_OPTIONS = new Set(["title", "meta", "favicon", "base"]);

// Build-ergonomics options with no effect on the emitted page.
const DROPPABLE_OPTIONS = new Set(["cache", "showErrors", "chunksSortMode"]);

// Manual migration paths appended to the review comment where one exists.
const LOST_OPTION_HINTS = new Map([
  ["publicPath", "set output.publicPath"],
  ["hash", "use [contenthash] in output.htmlFilename"],
  ["chunks", "use per-entry `html` descriptors"],
  ["excludeChunks", "use per-entry `html` descriptors"],
  ["scriptLoading", "module scripts come from output.module"],
  ["templateContent", "author the page as an .html entry file"],
]);

export type PageMode = "single" | "template" | "multi";

// Everything one plugin instance contributes to its enclosing config.
export interface InstanceFindings {
  minification: Minification;
  htmlProps: HtmlProp[];
  htmlFilename: string | null;
  templateValue: string | null;
  lost: string[];
  notes: string[];
  // `entry` property to create when the config had none (template mode).
  pendingEntry: { text: string; comment: string } | null;
  // `scriptLoading: "module"` — ESM output, set config-wide.
  scriptLoadingModule: boolean;
}

function describeLost(name: string): string {
  const hint = LOST_OPTION_HINTS.get(name);

  return hint ? `${name} (${hint})` : name;
}

export function collectFindings(
  optionsObject: SgNode<Js> | undefined,
  skippedOptions?: Set<string>,
): InstanceFindings {
  const findings: InstanceFindings = {
    minification: collectMinification(
      optionsObject ? findPair(optionsObject, "minify")?.field("value") : undefined,
      "minify",
    ),
    htmlProps: [],
    htmlFilename: null,
    templateValue: null,
    lost: [],
    notes: [],
    pendingEntry: null,
    scriptLoadingModule: false,
  };

  if (!optionsObject) {
    return findings;
  }

  const templateValue = findPair(optionsObject, "template")?.field("value");
  const templateMode = Boolean(templateValue);

  if (templateValue) {
    if (templateValue.is("string")) {
      findings.templateValue = templateValue.text();
    } else {
      findings.lost.push("template");
    }
  }

  for (const optionPair of pairsOf(optionsObject)) {
    const name = keyName(optionPair);
    const optionValue = optionPair.field("value");

    if (!name || !optionValue) {
      findings.lost.push("options");

      continue;
    }

    if (name === "template" || DROPPABLE_OPTIONS.has(name)) {
      continue;
    }

    if (skippedOptions && skippedOptions.has(name)) {
      continue;
    }

    collectOption(name, optionValue, templateMode, findings);
  }

  return findings;
}

function collectOption(
  name: string,
  value: SgNode<Js>,
  templateMode: boolean,
  findings: InstanceFindings,
): void {
  const literal = value.is("string") ? unquote(value.text()) : null;

  // Head tags are only injected into webpack-generated pages, never into an
  // authored template — there the tag belongs in the template itself.
  if (HEAD_TAG_OPTIONS.has(name) && templateMode) {
    findings.lost.push(`${name} (add it to the template)`);

    return;
  }

  switch (name) {
    case "filename":
      if (value.is("string")) {
        findings.htmlFilename = value.text();
      } else {
        findings.lost.push(describeLost(name));
      }

      break;
    case "title":
    case "favicon":
    case "base":
      findings.htmlProps.push({ name, valueText: value.text() });

      break;
    case "meta":
      collectMetaOption(value, findings);

      break;
    case "inject":
      // `true` is the native default placement; the template authors its own tags.
      if (templateMode || value.is("true")) {
        break;
      }

      if (value.is("false") || literal === "body" || literal === "head") {
        findings.htmlProps.push({
          name,
          valueText: value.is("false") ? "false" : `"${literal}"`,
        });
      } else {
        findings.lost.push(describeLost(name));
      }

      break;
    case "scriptLoading":
      // Native `"auto"` already defers classic scripts.
      if (literal === "defer") {
        break;
      }

      if (templateMode) {
        if (literal === "module") {
          findings.lost.push(
            'scriptLoading (enable output.module and use <script type="module"> in the template)',
          );
        }
      } else if (literal === "blocking") {
        findings.htmlProps.push({ name, valueText: '"blocking"' });
      } else if (literal === "module") {
        findings.scriptLoadingModule = true;
      } else {
        findings.lost.push(describeLost(name));
      }

      break;
    case "minify":
      findings.lost.push(...findings.minification.lost);

      break;
    case "chunks":
      if (literal !== "all") {
        findings.lost.push(describeLost(name));
      }

      break;
    case "publicPath":
      if (literal !== "auto") {
        findings.lost.push(describeLost(name));
      }

      break;
    case "hash":
    case "xhtml":
      if (!value.is("false")) {
        findings.lost.push(describeLost(name));
      }

      break;
    default:
      findings.lost.push(describeLost(name));
  }
}

// Meta values map when they are `content` strings, or `{ name |
// property, content }` objects (native keys `og:*` use `property` on their
// own); anything else — extra attributes, `http-equiv` — is flagged per key.
function collectMetaOption(value: SgNode<Js>, findings: InstanceFindings): void {
  if (!value.is("object")) {
    findings.lost.push("meta");

    return;
  }

  const parts: string[] = [];

  for (const metaPair of pairsOf(value)) {
    const metaKey = keyName(metaPair);
    const metaValue = metaPair.field("value");

    if (!metaKey || !metaValue) {
      findings.lost.push("meta");

      continue;
    }

    if (metaValue.is("string")) {
      parts.push(metaPair.text());

      continue;
    }

    if (metaValue.is("object")) {
      const nameValue = (findPair(metaValue, "name") ?? findPair(metaValue, "property"))?.field(
        "value",
      );
      const contentValue = findPair(metaValue, "content")?.field("value");
      const extraKeys = pairsOf(metaValue)
        .map((pair) => keyName(pair))
        .filter((key) => key !== "name" && key !== "property" && key !== "content");

      if (nameValue?.is("string") && contentValue && !extraKeys.length) {
        parts.push(`"${unquote(nameValue.text())}": ${contentValue.text()}`);

        continue;
      }
    }

    findings.lost.push(`meta.${metaKey}`);
  }

  if (parts.length) {
    findings.htmlProps.push({ name: "meta", valueText: `{ ${parts.join(", ")} }` });
  }
}

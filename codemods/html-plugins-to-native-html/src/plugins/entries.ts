import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  findPair,
  keyName,
  lineIndent,
  namedChildren,
  pairsOf,
  unquote,
} from "@webpack/codemod-utils";
import type { InstanceFindings } from "./options";
import { queueTemplate } from "../migration-state";
import { templateScriptTag } from "../templates";

// With `output.html` each entry gets its own page, unlike the plugin's
// single page referencing every chunk — worth a note on multi-entry configs.
export function noteMultiPageEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
  const entryValue = findPair(configObject, "entry")?.field("value");

  if (entryValue && entryValue.is("object") && pairsOf(entryValue).length > 1) {
    findings.notes.push(
      "output.html emits one page per entry; html-webpack-plugin emitted a single page with every chunk",
    );
  }
}

// The template becomes the entry (native HTML entry point); the previous
// entry must be referenced from the template with a `<script>` tag. The HTML
// workflow step applies that edit through the runner using shared state.
export function migrateEntry(
  editor: ConfigEditor,
  configFileName: string,
  configObject: SgNode<Js>,
  findings: InstanceFindings,
): void {
  const templateValue = findings.templateValue as string;
  const entryPair = findPair(configObject, "entry");

  if (!entryPair) {
    const injected = queueTemplate(
      configFileName,
      unquote(templateValue),
      "./src/index.js",
      "main",
    );

    findings.pendingEntry = {
      text: templateValue,
      comment: injected
        ? `The template is now the entry: it must load the previous default entry via ${templateScriptTag(
            { src: injected, chunkName: "main" },
          )} (added by the HTML workflow step when the template is included)`
        : `The template is now the entry: reference the previous entry (webpack's default is ./src/index.js) from it, e.g. <script defer src="./src/index.js"></script>`,
    };

    return;
  }

  const entryValue = entryPair.field("value");
  const replaceable = entryValue ? replaceableEntryValue(entryValue) : null;

  if (!replaceable) {
    findings.lost.push("template (make the template an .html entry that loads your JS)");

    return;
  }

  const chunkName = entryValue?.is("object") ? keyName(pairsOf(entryValue)[0]) ?? "main" : "main";
  const injected = queueTemplate(
    configFileName,
    unquote(templateValue),
    unquote(replaceable.text()),
    chunkName,
  );
  const comment = injected
    ? `The template is now the entry: it must load the previous entry via ${templateScriptTag({
        src: injected,
        chunkName,
      })} (added by the HTML workflow step when the template is included)`
    : `The template is now the entry: reference the previous entry from it, e.g. <script defer src=${replaceable.text()}></script>`;
  const multiline = configObject.range().start.line !== configObject.range().end.line;

  if (multiline) {
    const indent = lineIndent(editor.source, entryPair.range().start.index);

    editor.addEdit({
      startPos: entryPair.range().start.index,
      endPos: entryPair.range().start.index,
      insertedText: `// ${comment}\n${indent}`,
    });
    editor.replace(replaceable, findings.templateValue as string);
  } else {
    editor.replace(
      replaceable,
      `/* ${comment.replace(/\*\//g, "* /")} */ ${findings.templateValue}`,
    );
  }
}

// A string entry value the template path can take over: the value itself, a
// single-element array, or a single-key object's string value.
export function replaceableEntryValue(entryValue: SgNode<Js>): SgNode<Js> | null {
  if (entryValue.is("string")) {
    return entryValue;
  }

  if (entryValue.is("array")) {
    const elements = namedChildren(entryValue);

    return elements.length === 1 && elements[0].is("string") ? elements[0] : null;
  }

  if (entryValue.is("object")) {
    const entryPairs = pairsOf(entryValue);

    if (entryPairs.length !== 1) {
      return null;
    }

    if (namedChildren(entryValue).some((child) => !child.is("pair") && !child.is("comment"))) {
      return null;
    }

    const key = entryPairs[0].field("key");

    if (
      !key ||
      key.is("computed_property_name") ||
      key.findAll({ rule: { kind: "escape_sequence" } }).length ||
      // Escaped identifiers are leaf tokens; the parser exposes no escape child.
      (key.is("property_identifier") && key.text().includes("\\"))
    ) {
      return null;
    }

    const inner = entryPairs[0].field("value");

    return inner && inner.is("string") ? inner : null;
  }

  return null;
}

import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { ConfigEditor, findPair, namedChildren, unquote } from "@webpack/codemod-utils";
import { planMinification, type Minification } from "./minification";

export interface HtmlProp {
  name: string;
  valueText: string;
}

export function dedupeProps(props: HtmlProp[]): HtmlProp[] {
  const seen = new Set<string>();

  return props.filter((prop) => !seen.has(prop.name) && seen.add(prop.name));
}

// Properties to add to one webpack config object once all removals are known.
export interface ConfigPlan {
  config: SgNode<Js>;
  sourceDefaults: boolean;
  minification: Minification[];
  commentLines: string[];
  // Emit a global `output.html` (single-page mode; per-entry pages skip it).
  htmlEnabled: boolean;
  // Props composing the `output.html` object (plugin options, sibling plugins).
  htmlProps: HtmlProp[];
  htmlFilename: string | null;
  // Other output-level props (e.g. `module` for ESM script loading).
  outputProps: HtmlProp[];
  experimentsProps: HtmlProp[];
  pendingEntry: { text: string; comment: string } | null;
  // A html-webpack-plugin instance in this config was migrated.
  pluginMigratedHere: boolean;
}

export class ConfigPlans {
  private readonly configPlans = new Map<number, ConfigPlan>();

  private readonly editor: ConfigEditor;

  constructor(editor: ConfigEditor) {
    this.editor = editor;
  }

  planFor(config: SgNode<Js>): ConfigPlan {
    const key = config.range().start.index;
    let plan = this.configPlans.get(key);

    if (!plan) {
      plan = {
        config,
        sourceDefaults: false,
        minification: [],
        commentLines: [],
        htmlEnabled: false,
        htmlProps: [],
        htmlFilename: null,
        outputProps: [],
        experimentsProps: [],
        pendingEntry: null,
        pluginMigratedHere: false,
      };
      this.configPlans.set(key, plan);
    }

    return plan;
  }

  requireExperimentsHtml(plan: ConfigPlan): void {
    if (!plan.experimentsProps.some((prop) => prop.name === "html")) {
      plan.experimentsProps.push({ name: "html", valueText: "true" });
    }
  }

  // `scriptLoading: "module"` means ESM output — a config-wide switch.
  applyModuleScripts(plan: ConfigPlan, moduleScripts: boolean): void {
    if (!moduleScripts) {
      return;
    }

    if (!plan.outputProps.some((prop) => prop.name === "module")) {
      plan.outputProps.push({ name: "module", valueText: "true" });
    }

    // ESM output is stable since webpack 5.111. Remove the obsolete flag
    // only when its value is a literal, preserving any expression side effects.
    const experiments = findPair(plan.config, "experiments")?.field("value");
    const flag = experiments?.is("object") ? findPair(experiments, "outputModule") : undefined;
    const value = flag?.field("value");

    if (flag && (value?.is("true") || value?.is("false"))) {
      this.editor.keepBracesOpen(experiments!);
      this.editor.markForRemoval(flag);
    }
  }

  canNormalizeSourceDefaults(config: SgNode<Js>): boolean {
    let current: SgNode<Js> = config;

    for (const name of ["module", "parser", "html"]) {
      const value = findPair(current, name)?.field("value");

      if (!value) {
        return true;
      }

      if (
        !value.is("object") ||
        namedChildren(value).some((child) => !child.is("pair") && !child.is("comment"))
      ) {
        return false;
      }

      current = value;
    }

    const sources = findPair(current, "sources")?.field("value");

    if (!sources || sources.is("true")) {
      return true;
    }

    const elements = sources.is("array")
      ? namedChildren(sources).filter((node) => !node.is("comment"))
      : [];

    return (
      elements.length === 1 && elements[0].is("string") && unquote(elements[0].text()) === "..."
    );
  }

  private normalizeSourceDefaults(config: SgNode<Js>): void {
    // Rule parser options are clever-merged with global HTML parser defaults.
    // Its default `sources: true` would expand a rule's "..." to `[true, ...]`,
    // which fails validation. `["..."]` is equivalent but survives that merge.
    let current = findPair(config, "module")!.field("value")!;

    for (const [name, text] of [
      ["parser", 'parser: { html: { sources: ["..."] } }'],
      ["html", 'html: { sources: ["..."] }'],
    ]) {
      const value = findPair(current, name)?.field("value");

      if (!value) {
        this.editor.insertIntoObject(current, () => [text]);

        return;
      }

      current = value;
    }

    const sources = findPair(current, "sources")?.field("value");

    if (sources?.is("true")) {
      this.editor.replace(sources, '["..."]');
    } else if (!sources) {
      this.editor.insertIntoObject(current, () => ['sources: ["..."]']);
    }
  }

  planConfigInsertions(): void {
    for (const plan of this.configPlans.values()) {
      if (plan.sourceDefaults) {
        this.normalizeSourceDefaults(plan.config);
      }

      const topProperties: ((indent: string, unit: string) => string)[] = [];
      const optimization = planMinification(
        this.editor,
        plan.config,
        plan.minification,
        plan.commentLines,
      );

      if (optimization) {
        topProperties.push(() => optimization);
      }

      const pendingEntry = plan.pendingEntry;

      if (pendingEntry) {
        topProperties.push(
          (indent) => `// ${pendingEntry.comment}\n${indent}entry: ${pendingEntry.text}`,
        );
      }

      const outputProps: HtmlProp[] = [];
      const htmlProps = dedupeProps(plan.htmlProps);
      const existingOutput = findPair(plan.config, "output")?.field("value");
      const existingHtml = existingOutput?.is("object")
        ? findPair(existingOutput, "html")?.field("value")
        : undefined;

      if (existingHtml?.is("object")) {
        const missing = htmlProps.filter((prop) => !findPair(existingHtml, prop.name));

        if (missing.length) {
          this.editor.insertIntoObject(existingHtml, () =>
            missing.map((prop) => `${prop.name}: ${prop.valueText}`),
          );
        }
      }

      if (plan.htmlEnabled || htmlProps.length) {
        outputProps.push({
          name: "html",
          valueText: htmlProps.length
            ? `{ ${htmlProps.map((prop) => `${prop.name}: ${prop.valueText}`).join(", ")} }`
            : "true",
        });
      }

      if (plan.htmlFilename !== null) {
        outputProps.push({ name: "htmlFilename", valueText: plan.htmlFilename });
      }

      outputProps.push(...plan.outputProps);

      if (outputProps.length) {
        this.planObjectProps(plan.config, "output", outputProps, plan.commentLines, topProperties);
      }

      if (plan.experimentsProps.length) {
        this.planObjectProps(
          plan.config,
          "experiments",
          plan.experimentsProps,
          outputProps.length ? [] : plan.commentLines,
          topProperties,
        );
      }

      if (!outputProps.length && !plan.experimentsProps.length && plan.commentLines.length) {
        this.insertReviewComments(plan.config, plan.commentLines);
      }

      if (topProperties.length) {
        // A fully-emptied config keeps its braces open for these properties.
        this.editor.keepBracesOpen(plan.config);
        this.editor.insertIntoObject(plan.config, (indent, unit) =>
          topProperties.map((build) => build(indent, unit)),
        );
      }
    }
  }

  private insertReviewComments(node: SgNode<Js>, lines: string[]): void {
    if (!lines.length) {
      return;
    }

    const position = node.range().start.index;

    this.editor.addEdit({
      startPos: position,
      endPos: position,
      insertedText: `/* ${lines.join("; ").replace(/\*\//g, "* /")} */ `,
    });
  }

  // Insert props into the config's `key` object, creating it when absent; an
  // existing non-object value (e.g. a variable) is left alone. Comment lines
  // ride on the first inserted property.
  private planObjectProps(
    config: SgNode<Js>,
    key: string,
    props: HtmlProp[],
    commentLines: string[],
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    const withComments = (propertyText: string, indent: string, first: boolean): string => {
      if (!first || !commentLines.length) {
        return propertyText;
      }

      if (!config.text().includes("\n")) {
        return `/* ${commentLines.join("; ").replace(/\*\//g, "* /")} */ ${propertyText}`;
      }

      return `${commentLines.map((line) => `// ${line}\n${indent}`).join("")}${propertyText}`;
    };
    const value = findPair(config, key)?.field("value");

    if (value && value.is("object")) {
      for (const prop of props) {
        const existing = findPair(value, prop.name)?.field("value");

        if (!existing) {
          continue;
        }

        if (
          (key === "experiments" && prop.name === "html") ||
          (key === "output" && prop.name === "module") ||
          (key === "output" &&
            prop.name === "html" &&
            (existing.is("false") || existing.is("true")))
        ) {
          this.editor.replace(existing, prop.valueText);
        }
      }

      const missing = props.filter((prop) => !findPair(value, prop.name));

      if (!missing.length) {
        this.insertReviewComments(value, commentLines);

        return;
      }

      this.editor.insertIntoObject(value, (indent) =>
        missing.map((prop, index) =>
          withComments(`${prop.name}: ${prop.valueText}`, indent, index === 0),
        ),
      );
    } else if (!value) {
      topProperties.push((indent, unit) => {
        const inner = indent + unit;
        const texts = props.map((prop, index) =>
          withComments(`${prop.name}: ${prop.valueText}`, inner, index === 0),
        );

        return `${key}: {\n${texts.map((text) => `${inner}${text}`).join(",\n")},\n${indent}}`;
      });
    }
  }
}

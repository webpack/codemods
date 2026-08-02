import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode, SgRoot } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  findPair,
  guardBranchesOf,
  keyName,
  lineIndent,
  namedChildren,
  pairsOf,
  unquote,
  unwrapFilterCall,
  collectModuleBindings,
} from "@webpack/codemod-utils";

const PLUGIN_MODULE = "html-webpack-plugin";
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
  ["scriptLoading", "module scripts come from experiments.outputModule"],
  ["minify", "native HTML minifies production output on its own"],
  ["templateContent", "author the page as an .html entry file"],
]);

interface HtmlProp {
  name: string;
  valueText: string;
}

// Everything one plugin instance contributes to its enclosing config.
interface InstanceFindings {
  htmlProps: HtmlProp[];
  htmlFilename: string | null;
  templateValue: string | null;
  lost: string[];
  notes: string[];
  // `entry` property to create when the config had none (template mode).
  pendingEntry: { text: string; comment: string } | null;
}

class HtmlMigration {
  private readonly editor: ConfigEditor;
  private readonly pluginBindings;
  private readonly pluginNames: Set<string>;

  constructor(root: SgRoot<Js>) {
    this.editor = new ConfigEditor(root.root());
    this.pluginBindings = collectModuleBindings(this.editor.rootNode, PLUGIN_MODULE);
    this.pluginNames = new Set(this.pluginBindings.map((binding) => binding.name));
  }

  run(): string | null {
    if (!this.pluginNames.size) return null;
    // Hook taps (`getHooks`, `getCompilationHooks`) have no native counterpart
    // that keeps the tap working — leave such files for manual migration.
    if (this.usesPluginHooks()) return null;
    for (const pair of this.editor.rootNode.findAll({ rule: { kind: "pair" } })) {
      if (keyName(pair) === "plugins") this.transformPluginsPair(pair);
    }
    this.editor.finalizeRemovals();
    if (!this.editor.hasEdits) return null;
    for (const binding of this.pluginBindings) {
      this.editor.removeBindingIfUnused(binding);
    }
    return this.editor.commit();
  }

  private usesPluginHooks(): boolean {
    for (const node of this.editor.rootNode.findAll({ rule: { kind: "member_expression" } })) {
      const property = node.field("property")?.text();
      if (property !== "getHooks" && property !== "getCompilationHooks") continue;
      const objectPart = node.field("object");
      if (objectPart && this.pluginNames.has(objectPart.text())) return true;
    }
    return false;
  }

  // The plugin instantiation behind a plugins element, unwrapping guards.
  private pluginInstantiationOf(element: SgNode<Js>): SgNode<Js> | null {
    const branches = guardBranchesOf(element);
    if (branches) {
      for (const branch of branches) {
        const found = this.pluginInstantiationOf(branch);
        if (found) return found;
      }
      return null;
    }
    if (element.kind() !== "new_expression") return null;
    const constructorNode = element.field("constructor");
    return constructorNode && this.pluginNames.has(constructorNode.text()) ? element : null;
  }

  private transformPluginsPair(pluginsPair: SgNode<Js>): void {
    const configObject = pluginsPair.parent();
    if (!configObject || configObject.kind() !== "object") return;
    const value = unwrapFilterCall(pluginsPair.field("value") ?? pluginsPair);
    if (value.kind() !== "array") return;
    const elements = namedChildren(value);
    const instances: { element: SgNode<Js>; instantiation: SgNode<Js> }[] = [];
    for (const element of elements) {
      const instantiation = this.pluginInstantiationOf(element);
      if (instantiation) instances.push({ element, instantiation });
    }
    // Several instances mean several pages (`chunks` per page) — per-entry
    // `html` descriptors cover it, but mapping them safely needs a human.
    if (instances.length !== 1) return;
    const { element, instantiation } = instances[0];
    const argumentsNode = instantiation.field("arguments");
    const optionsObject = argumentsNode ? namedChildren(argumentsNode)[0] : undefined;
    // A non-literal options argument (variable, spread) can't be understood.
    if (optionsObject && optionsObject.kind() !== "object") return;
    const findings = this.collectFindings(optionsObject);
    if (elements.length === 1) this.editor.markForRemoval(pluginsPair);
    else this.editor.markForRemoval(element);
    if (findings.templateValue !== null) this.migrateEntry(configObject, findings);
    else this.noteMultiPageEntry(configObject, findings);
    this.planConfigInsertions(configObject, findings);
  }

  // ---------- option mapping ----------

  private collectFindings(optionsObject: SgNode<Js> | undefined): InstanceFindings {
    const findings: InstanceFindings = {
      htmlProps: [],
      htmlFilename: null,
      templateValue: null,
      lost: [],
      notes: [],
      pendingEntry: null,
    };
    if (!optionsObject) return findings;
    const templateValue = findPair(optionsObject, "template")?.field("value");
    const templateMode = Boolean(templateValue);
    if (templateValue) {
      if (templateValue.kind() === "string") findings.templateValue = templateValue.text();
      else findings.lost.push("template");
    }
    for (const optionPair of pairsOf(optionsObject)) {
      const name = keyName(optionPair);
      const optionValue = optionPair.field("value");
      if (!name || !optionValue) {
        findings.lost.push("options");
        continue;
      }
      if (name === "template" || DROPPABLE_OPTIONS.has(name)) continue;
      this.collectOption(name, optionValue, templateMode, findings);
    }
    return findings;
  }

  private collectOption(
    name: string,
    value: SgNode<Js>,
    templateMode: boolean,
    findings: InstanceFindings,
  ): void {
    const literal = value.kind() === "string" ? unquote(value.text()) : null;
    // Head tags are only injected into webpack-generated pages, never into an
    // authored template — there the tag belongs in the template itself.
    if (HEAD_TAG_OPTIONS.has(name) && templateMode) {
      findings.lost.push(`${name} (add it to the template)`);
      return;
    }
    switch (name) {
      case "filename":
        if (value.kind() === "string") findings.htmlFilename = value.text();
        else findings.lost.push(this.describeLost(name));
        break;
      case "title":
      case "favicon":
      case "base":
        findings.htmlProps.push({ name, valueText: value.text() });
        break;
      case "meta":
        // Native meta values are `content` strings; attribute objects are not.
        if (
          value.kind() === "object" &&
          pairsOf(value).every((pair) => pair.field("value")?.kind() === "string")
        ) {
          findings.htmlProps.push({ name, valueText: value.text() });
        } else {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "inject":
        // `true` is the native default placement; the template authors its own tags.
        if (templateMode || value.kind() === "true") break;
        if (value.kind() === "false" || literal === "body" || literal === "head") {
          findings.htmlProps.push({ name, valueText: value.kind() === "false" ? "false" : `"${literal}"` });
        } else {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "scriptLoading":
        // Native `"auto"` already defers classic scripts.
        if (templateMode || literal === "defer") break;
        if (literal === "blocking") {
          findings.htmlProps.push({ name, valueText: '"blocking"' });
        } else {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "minify":
        if (value.kind() !== "true" && literal !== "auto") {
          findings.lost.push(this.describeLost(name));
        }
        break;
      case "chunks":
        if (literal !== "all") findings.lost.push(this.describeLost(name));
        break;
      case "publicPath":
        if (literal !== "auto") findings.lost.push(this.describeLost(name));
        break;
      case "hash":
      case "xhtml":
        if (value.kind() !== "false") findings.lost.push(this.describeLost(name));
        break;
      default:
        findings.lost.push(this.describeLost(name));
    }
  }

  private describeLost(name: string): string {
    const hint = LOST_OPTION_HINTS.get(name);
    return hint ? `${name} (${hint})` : name;
  }

  // ---------- entry handling ----------

  // With `output.html` each entry gets its own page, unlike the plugin's
  // single page referencing every chunk — worth a note on multi-entry configs.
  private noteMultiPageEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const entryValue = findPair(configObject, "entry")?.field("value");
    if (entryValue && entryValue.kind() === "object" && pairsOf(entryValue).length > 1) {
      findings.notes.push(
        "output.html emits one page per entry; html-webpack-plugin emitted a single page with every chunk",
      );
    }
  }

  // The template becomes the entry (native HTML entry point); the previous
  // entry must be referenced from the template with a `<script>` tag.
  private migrateEntry(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const entryPair = findPair(configObject, "entry");
    if (!entryPair) {
      findings.pendingEntry = {
        text: findings.templateValue as string,
        comment: `The template is now the entry: reference the previous entry (webpack's default is ./src/index.js) from it, e.g. <script defer src="./src/index.js"></script>`,
      };
      return;
    }
    const entryValue = entryPair.field("value");
    const replaceable = entryValue ? this.replaceableEntryValue(entryValue) : null;
    if (!replaceable) {
      findings.lost.push("template (make the template an .html entry that loads your JS)");
      return;
    }
    const comment = `The template is now the entry: reference the previous entry from it, e.g. <script defer src=${replaceable.text()}></script>`;
    const multiline = configObject.text().includes("\n");
    if (multiline) {
      const indent = lineIndent(this.editor.source, entryPair.range().start.index);
      this.editor.addEdit({
        startPos: entryPair.range().start.index,
        endPos: entryPair.range().start.index,
        insertedText: `// ${comment}\n${indent}`,
      });
      this.editor.replace(replaceable, findings.templateValue as string);
    } else {
      this.editor.replace(replaceable, `/* ${comment} */ ${findings.templateValue}`);
    }
  }

  // A string entry value the template path can take over: the value itself, a
  // single-element array, or a single-key object's string value.
  private replaceableEntryValue(entryValue: SgNode<Js>): SgNode<Js> | null {
    if (entryValue.kind() === "string") return entryValue;
    if (entryValue.kind() === "array") {
      const elements = namedChildren(entryValue);
      return elements.length === 1 && elements[0].kind() === "string" ? elements[0] : null;
    }
    if (entryValue.kind() === "object") {
      const entryPairs = pairsOf(entryValue);
      if (entryPairs.length !== 1) return null;
      const inner = entryPairs[0].field("value");
      return inner && inner.kind() === "string" ? inner : null;
    }
    return null;
  }

  // ---------- config-level insertions ----------

  private planConfigInsertions(configObject: SgNode<Js>, findings: InstanceFindings): void {
    const commentLines: string[] = [];
    if (findings.lost.length) {
      commentLines.push(
        `Removed html-webpack-plugin options without a native HTML equivalent: ${[...new Set(findings.lost)].join(", ")}`,
      );
    }
    commentLines.push(...findings.notes);
    const outputProps: { name: string; valueText: string }[] = [];
    if (findings.templateValue === null) {
      const htmlValue = findings.htmlProps.length
        ? `{ ${findings.htmlProps.map((prop) => `${prop.name}: ${prop.valueText}`).join(", ")} }`
        : "true";
      outputProps.push({ name: "html", valueText: htmlValue });
    }
    // The plugin emitted `index.html` by default; native defaults to `[name].html`.
    outputProps.push({ name: "htmlFilename", valueText: findings.htmlFilename ?? '"index.html"' });
    const topProperties: ((indent: string, unit: string) => string)[] = [];
    const pendingEntry = findings.pendingEntry;
    if (pendingEntry) {
      topProperties.push((indent) => `// ${pendingEntry.comment}\n${indent}entry: ${pendingEntry.text}`);
    }
    this.planObjectProps(configObject, "output", outputProps, commentLines, topProperties);
    this.planObjectProps(configObject, "experiments", [{ name: "html", valueText: "true" }], [], topProperties);
    if (topProperties.length) {
      // A fully-emptied config keeps its braces open for these properties.
      this.editor.keepBracesOpen(configObject);
      this.editor.insertIntoObject(configObject, (indent, unit) =>
        topProperties.map((build) => build(indent, unit)),
      );
    }
  }

  // Insert props into the config's `key` object, creating it when absent; an
  // existing non-object value (e.g. a variable) is left alone. Comment lines
  // ride on the first inserted property.
  private planObjectProps(
    config: SgNode<Js>,
    key: string,
    props: { name: string; valueText: string }[],
    commentLines: string[],
    topProperties: ((indent: string, unit: string) => string)[],
  ): void {
    const withComments = (propertyText: string, indent: string, first: boolean): string => {
      if (!first || !commentLines.length) return propertyText;
      return `${commentLines.map((line) => `// ${line}\n${indent}`).join("")}${propertyText}`;
    };
    const value = findPair(config, key)?.field("value");
    if (value && value.kind() === "object") {
      const missing = props.filter((prop) => !findPair(value, prop.name));
      if (!missing.length) return;
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

async function transform(root: SgRoot<Js>): Promise<string | null> {
  return new HtmlMigration(root).run();
}

export default transform;

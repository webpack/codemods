import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { Edit, SgNode, SgRoot } from "@codemod.com/jssg-types/main";

const PLUGIN_MODULE = "mini-css-extract-plugin";
const REMOVABLE_LOADERS = new Set(["style-loader", "css-loader"]);
// Rules whose `test` targets a preprocessor still need their loaders — skip them.
const PREPROCESSOR_TEST = /s[ac]ss|less|styl/;

interface Range {
  start: number;
  end: number;
}

function rangeOf(node: SgNode<Js>): Range {
  const range = node.range();
  return { start: range.start.index, end: range.end.index };
}

function unquote(text: string): string {
  return text.replace(/^["'`]/, "").replace(/["'`]$/, "");
}

function namedChildren(node: SgNode<Js>): SgNode<Js>[] {
  return node.children().filter((child) => child.isNamed());
}

function keyName(pair: SgNode<Js>): string | null {
  const key = pair.field("key");
  return key ? unquote(key.text()) : null;
}

function pairsOf(objectNode: SgNode<Js>): SgNode<Js>[] {
  return namedChildren(objectNode).filter((child) => child.kind() === "pair");
}

function findPair(objectNode: SgNode<Js>, name: string): SgNode<Js> | undefined {
  return pairsOf(objectNode).find((pair) => keyName(pair) === name);
}

// Whitespace at the start of the line containing `index`.
function lineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : "";
}

function isInsideAny(range: Range, ranges: Range[]): boolean {
  return ranges.some((outer) => range.start >= outer.start && range.end <= outer.end);
}

async function transform(root: SgRoot<Js>): Promise<string | null> {
  const rootNode = root.root();
  const source = rootNode.text();

  // Bindings introduced by `require`/`import` of mini-css-extract-plugin.
  const pluginBindings: { name: string; statement: SgNode<Js> }[] = [];
  const importPatterns = [
    "const $NAME = require($SOURCE)",
    "let $NAME = require($SOURCE)",
    "var $NAME = require($SOURCE)",
    "import $NAME from $SOURCE",
  ];
  for (const pattern of importPatterns) {
    for (const statement of rootNode.findAll({ rule: { pattern } })) {
      const name = statement.getMatch("NAME");
      const moduleSource = statement.getMatch("SOURCE");
      if (!name || !moduleSource) continue;
      if (unquote(moduleSource.text()) !== PLUGIN_MODULE) continue;
      pluginBindings.push({ name: name.text(), statement });
    }
  }
  const pluginNames = new Set(pluginBindings.map((binding) => binding.name));

  // `MiniCssExtractPlugin.loader` or `require("mini-css-extract-plugin").loader`.
  const isPluginLoaderExpression = (node: SgNode<Js>): boolean => {
    if (node.kind() !== "member_expression") return false;
    const objectPart = node.field("object");
    const propertyPart = node.field("property");
    if (!objectPart || !propertyPart || propertyPart.text() !== "loader") return false;
    if (objectPart.kind() === "identifier") return pluginNames.has(objectPart.text());
    return (
      objectPart.kind() === "call_expression" &&
      /^require\(\s*["'`]mini-css-extract-plugin["'`]\s*\)$/.test(objectPart.text())
    );
  };

  const isRemovableLoaderValue = (node: SgNode<Js>): boolean => {
    if (node.kind() === "string") return REMOVABLE_LOADERS.has(unquote(node.text()));
    return isPluginLoaderExpression(node);
  };

  // A `use` array entry replaceable by native CSS: a known loader string,
  // the plugin's `.loader`, or `{ loader: <one of those>, ... }`.
  const isRemovableUseElement = (node: SgNode<Js>): boolean => {
    if (isRemovableLoaderValue(node)) return true;
    if (node.kind() !== "object") return false;
    const loaderPair = findPair(node, "loader");
    if (!loaderPair) return false;
    const loaderValue = loaderPair.field("value");
    return loaderValue ? isRemovableLoaderValue(loaderValue) : false;
  };

  const edits: Edit[] = [];
  const editedRanges: Range[] = [];
  const configObjects: SgNode<Js>[] = [];

  const removeText = (range: Range): void => {
    edits.push({ startPos: range.start, endPos: range.end, insertedText: "" });
    editedRanges.push(range);
  };

  // Removal range for one element of a comma-separated list (array/object).
  const listItemRemovalRange = (node: SgNode<Js>): Range => {
    const parent = node.parent();
    const range = rangeOf(node);
    if (!parent) return range;
    const siblings = namedChildren(parent);
    const index = siblings.findIndex((sibling) => sibling.range().start.index === range.start);
    const next = siblings[index + 1];
    if (next) return { start: range.start, end: next.range().start.index };
    const previous = siblings[index - 1];
    if (previous) return { start: previous.range().end.index, end: range.end };
    return range;
  };

  // The enclosing webpack config object: nearest ancestor holding a `module` pair.
  const findConfigForRule = (node: SgNode<Js>): SgNode<Js> | null => {
    let current = node.parent();
    while (current) {
      if (current.kind() === "pair" && keyName(current) === "module") {
        const parent = current.parent();
        if (parent && parent.kind() === "object") return parent;
      }
      current = current.parent();
    }
    return null;
  };

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "use") continue;
    const value = pair.field("value");
    if (!value) continue;
    const elements = value.kind() === "array" ? namedChildren(value) : [value];
    if (!elements.length || !elements.every(isRemovableUseElement)) continue;
    const ruleObject = pair.parent();
    if (!ruleObject || ruleObject.kind() !== "object") continue;
    const testValue = findPair(ruleObject, "test")?.field("value");
    if (testValue && PREPROCESSOR_TEST.test(testValue.text())) continue;
    edits.push(pair.replace('type: "css/auto"'));
    editedRanges.push(rangeOf(pair));
    const config = findConfigForRule(pair);
    if (config) configObjects.push(config);
  }

  for (const pair of rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "plugins") continue;
    const value = pair.field("value");
    if (!value || value.kind() !== "array") continue;
    const elements = namedChildren(value);
    const removed = elements.filter((element) => {
      if (element.kind() !== "new_expression") return false;
      const constructorNode = element.field("constructor");
      return constructorNode !== null && pluginNames.has(constructorNode.text());
    });
    if (!removed.length) continue;
    if (removed.length === elements.length) {
      removeText(listItemRemovalRange(pair));
    } else {
      for (const element of removed) removeText(listItemRemovalRange(element));
    }
    const parent = pair.parent();
    if (parent && parent.kind() === "object") configObjects.push(parent);
  }

  if (!edits.length) return null;

  // Drop the plugin import once no reference survives outside the edited ranges.
  for (const binding of pluginBindings) {
    const statementRange = rangeOf(binding.statement);
    const survivingReference = rootNode
      .findAll({ rule: { kind: "identifier" } })
      .some((identifier) => {
        if (identifier.text() !== binding.name) return false;
        const range = rangeOf(identifier);
        if (range.start >= statementRange.start && range.end <= statementRange.end) return false;
        return !isInsideAny(range, editedRanges);
      });
    if (survivingReference) continue;
    let end = statementRange.end;
    if (source[end] === "\r") end += 1;
    if (source[end] === "\n") end += 1;
    edits.push({ startPos: statementRange.start, endPos: end, insertedText: "" });
  }

  // Insert a property right after an object's opening brace, matching its layout.
  const insertIntoObject = (
    objectNode: SgNode<Js>,
    buildProperty: (indent: string, indentUnit: string) => string,
  ): void => {
    const range = rangeOf(objectNode);
    const insertAt = range.start + 1;
    const properties = namedChildren(objectNode);
    const multiline = objectNode.text().includes("\n") && properties.length > 0;
    let insertedText: string;
    if (multiline) {
      const indent = lineIndent(source, properties[0].range().start.index);
      const indentUnit = indent.includes("\t") ? "\t" : indent || "  ";
      insertedText = `\n${indent}${buildProperty(indent, indentUnit)},`;
    } else if (properties.length) {
      insertedText = ` ${buildProperty("", "")},`;
    } else {
      insertedText = ` ${buildProperty("", "")} `;
    }
    edits.push({ startPos: insertAt, endPos: insertAt, insertedText });
  };

  const seenConfigs = new Set<number>();
  for (const config of configObjects) {
    const start = config.range().start.index;
    if (seenConfigs.has(start)) continue;
    seenConfigs.add(start);
    const experimentsValue = findPair(config, "experiments")?.field("value");
    if (experimentsValue) {
      if (experimentsValue.kind() !== "object") continue;
      if (findPair(experimentsValue, "css")) continue;
      insertIntoObject(experimentsValue, () => "css: true");
    } else {
      insertIntoObject(config, (indent, indentUnit) =>
        indent || indentUnit
          ? `experiments: {\n${indent}${indentUnit}css: true,\n${indent}}`
          : "experiments: { css: true }",
      );
    }
  }

  return rootNode.commitEdits(edits);
}

export default transform;

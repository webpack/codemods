import type Js from "@codemod.com/jssg-types/langs/javascript";
import type Ts from "@codemod.com/jssg-types/langs/typescript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  type ModuleBinding,
  collectModuleBindings,
  keyName,
  namedChildren,
  parseExpression,
  sameSyntax,
  staticString,
} from "@webpack/codemod-utils";

import { cssnanoOptions, literalProperties, type NativeCssOptions } from "./minimizer-options";

const MINIMIZER_MODULE = "css-minimizer-webpack-plugin";
const OTHER_ASSETS = ["javascript", "html", "json", "xml"];

function expressionOf(node: SgNode<Js>): SgNode<Js> {
  while (node.is("parenthesized_expression")) {
    const inner = namedChildren(node).find((child) => !child.is("comment"));

    if (!inner) {
      break;
    }

    node = inner;
  }

  return node;
}

function isMinimizer(node: SgNode<Js>, bindings: ModuleBinding[]): boolean {
  node = expressionOf(node);

  if (node.is("identifier")) {
    const binding = bindings.find((binding) => binding.name === node.text());
    const definition = binding && node.definition({ resolveExternal: false });

    if (!binding || !definition || definition.root.filename() !== node.getRoot().filename()) {
      return false;
    }

    const position = definition.node.range().start.index;
    const statement = binding.statement.range();

    return position >= statement.start.index && position < statement.end.index;
  }

  if (node.is("member_expression") && node.field("property")?.text() === "default") {
    const object = node.field("object");

    return !!object && isMinimizer(object, bindings);
  }

  if (!node.is("call_expression")) {
    return false;
  }

  const callee = node.field("function");
  const argumentsNode = node.field("arguments");
  const args = argumentsNode && namedChildren(argumentsNode).filter((arg) => !arg.is("comment"));

  return (
    !!callee?.is("identifier") &&
    callee.text() === "require" &&
    !callee.definition({ resolveExternal: false }) &&
    args?.length === 1 &&
    staticString(args[0]) === MINIMIZER_MODULE
  );
}

function collectOptions(instance: SgNode<Js>, bindings: ModuleBinding[]): NativeCssOptions | null {
  const argumentsNode = instance.field("arguments");
  const args = argumentsNode
    ? namedChildren(argumentsNode).filter((arg) => !arg.is("comment"))
    : [];

  if (!args.length) {
    return cssnanoOptions();
  }

  const properties = args.length === 1 && literalProperties(args[0]);

  if (!properties) {
    return null;
  }

  for (const [name, value] of properties) {
    if (name === "minimizerOptions" || (name === "parallel" && value.is("true"))) {
      continue;
    }

    if (name === "minify" && value.is("member_expression")) {
      const object = value.field("object");

      if (
        object &&
        isMinimizer(object, bindings) &&
        value.field("property")?.text() === "cssnanoMinify"
      ) {
        continue;
      }
    }

    // Asset filters, custom engines, warning filters and worker limits have no
    // equivalent in minimizeOptions.css. Keep the plugin and all its options.
    return null;
  }

  return cssnanoOptions(properties.get("minimizerOptions"));
}

function nativeOptionsText(options: NativeCssOptions): string {
  return `{ ${[...options].map(([name, value]) => `${name}: ${value}`).join(", ")} }`;
}

// Compute every insertion before touching the AST so conflicts leave the
// original minimizer intact. Explicit minimizeOptions overrides the shorthand.
function planOptions(
  editor: ConfigEditor,
  optimization: SgNode<Js>,
  properties: Map<string, SgNode<Js>>,
  css: NativeCssOptions,
  hasDefaults: boolean,
): (() => void) | null {
  const minimize = properties.get("minimize");
  const options =
    properties.get("minimizeOptions") ?? (minimize?.is("object") ? minimize : undefined);
  const existing = options ? literalProperties(options) : new Map<string, SgNode<Js>>();

  if (!existing) {
    return null;
  }

  const existingCss = existing.get("css");
  const cssProperties = existingCss
    ? literalProperties(existingCss)
    : new Map<string, SgNode<Js>>();

  if (!cssProperties) {
    return null;
  }

  for (const [name, value] of css) {
    const configured = cssProperties.get(name);

    if (configured && !sameSyntax(configured, parseExpression(value))) {
      return null;
    }
  }

  const additions: string[] = [];

  if (!hasDefaults) {
    // Adding "..." must not turn on JS/HTML/JSON/XML minification that the
    // original custom minimizer array had disabled.
    for (const type of OTHER_ASSETS) {
      const configured = existing.get(type);

      if (configured && !configured.is("false")) {
        return null;
      }

      if (!configured) {
        additions.push(`${type}: false`);
      }
    }
  }

  const missingCss = [...css].filter(([name]) => !cssProperties.has(name));

  if (!existingCss) {
    additions.push(`css: ${nativeOptionsText(css)}`);
  }

  return () => {
    if (existingCss && missingCss.length) {
      editor.insertIntoObject(existingCss, () =>
        missingCss.map(([name, value]) => `${name}: ${value}`),
      );
    }

    if (!additions.length) {
      return;
    }

    if (options) {
      editor.insertIntoObject(options, () => additions);
    } else {
      editor.insertIntoObject(optimization, () => [`minimizeOptions: { ${additions.join(", ")} }`]);
    }
  };
}

export function migrateMinimizers(editor: ConfigEditor): ModuleBinding[] {
  const assignments = editor.rootNode.findAll({
    rule: { any: [{ kind: "assignment_expression" }, { kind: "augmented_assignment_expression" }] },
  });
  const assignedNames = new Set(assignments.flatMap((assignment) => {
    const target = assignment.field("left");
    const names = target?.findAll({
      rule: { any: [{ kind: "identifier" }, { kind: "shorthand_property_identifier_pattern" }] },
    });

    return names?.map((node) => node.text()) ?? [];
  }));
  const bindings = collectModuleBindings(editor.rootNode, MINIMIZER_MODULE).filter(
    (binding) => !assignedNames.has(binding.name),
  );

  for (const pair of editor.rootNode.findAll({ rule: { kind: "pair" } })) {
    if (keyName(pair) !== "optimization") {
      continue;
    }

    const config = pair.parent();
    const optimization = pair.field("value");

    if (!config || !literalProperties(config) || !optimization) {
      continue;
    }

    const properties = literalProperties(optimization);
    const minimizer = properties?.get("minimizer");

    if (!properties || !minimizer?.is("array")) {
      continue;
    }

    const elements = namedChildren(minimizer).filter((node) => !node.is("comment"));

    if (elements.some((element) => element.is("spread_element"))) {
      continue;
    }

    const instances = minimizer.findAll({ rule: { kind: "new_expression" } }).filter((node) => {
      const constructor = node.field("constructor");

      return constructor && isMinimizer(constructor, bindings);
    });

    if (instances.length !== 1) {
      continue;
    }

    const instance = instances[0];
    const element = elements.find(
      (node) => expressionOf(node).range().start.index === instance.range().start.index,
    );
    const css = collectOptions(instance, bindings);

    if (!element || !css) {
      continue;
    }

    const hasDefaults = elements.some((node) => staticString(node) === "...");
    const applyOptions = planOptions(editor, optimization, properties, css, hasDefaults);

    if (!applyOptions) {
      continue;
    }

    applyOptions();

    if (hasDefaults) {
      editor.markForRemoval(element);
    } else {
      editor.replace(element, '"..."');
    }
  }

  // ConfigEditor checks ordinary identifier references. Retain bindings also
  // used as shorthand properties or TypeScript types outside a constructor.
  const otherReferences = (editor.rootNode as unknown as SgNode<Ts>).findAll({
    rule: { any: [{ kind: "shorthand_property_identifier" }, { kind: "type_identifier" }] },
  });

  return bindings.filter(
    (binding) => !otherReferences.some((reference) => reference.text() === binding.name),
  );
}

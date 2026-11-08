import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { namedChildren, staticString } from "@webpack/codemod-utils";

export const HTML_PACKAGES = [
  "html-webpack-plugin",
  "html-loader",
  "csp-html-webpack-plugin",
  "webpack-subresource-integrity",
  "favicons-webpack-plugin",
];

// These are module request values, not snippets of JavaScript. Account for
// webpack's inline loader chains, queries, and package subpaths.
export function packagesInRequest(request: string): string[] {
  const result = new Set<string>();

  for (const part of request.split("!")) {
    const path = part.split("?", 1)[0].split("#", 1)[0].replaceAll("\\", "/");
    const segments = path.split("/");
    const installed = segments.lastIndexOf("node_modules");
    const packagePath = installed < 0 ? path : segments.slice(installed + 1).join("/");

    for (const name of HTML_PACKAGES) {
      if (packagePath === name || packagePath.startsWith(`${name}/`)) {
        result.add(name);
      }
    }
  }

  return [...result];
}

function isModuleCall(node: SgNode<Js>): boolean {
  const callee = node.field("function");

  if (!callee) {
    return false;
  }

  if (callee.is("import") || (callee.is("identifier") && callee.text() === "require")) {
    return true;
  }

  if (!callee.is("member_expression") || callee.field("property")?.text() !== "resolve") {
    return false;
  }

  const object = callee.field("object");

  return (
    !!object &&
    (object.is("meta_property") || (object.is("identifier") && object.text() === "require"))
  );
}

function hasSyntaxError(node: SgNode<Js>): boolean {
  return node.is("ERROR") || node.children().some(hasSyntaxError);
}

export function sourcePackageReferences(root: SgNode<Js>): string[] {
  const references = new Set<string>();

  // An incomplete AST cannot establish that a package has become unused.
  if (hasSyntaxError(root)) {
    return [...HTML_PACKAGES];
  }

  // Literal module requests also appear in loader options and variables passed
  // to tooling. Comments and arbitrary surrounding source never count.
  for (const node of root.findAll({
    rule: { any: [{ kind: "string" }, { kind: "template_string" }, { kind: "binary_expression" }] },
  })) {
    const request = staticString(node);

    if (request === null) {
      continue;
    }

    for (const name of packagesInRequest(request)) {
      references.add(name);
    }
  }

  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isModuleCall(call)) {
      continue;
    }

    const args = call.field("arguments");
    const first = args && namedChildren(args).find((node) => !node.is("comment"));

    // Dynamic imports/resolvers need manual dependency review. Do not remove a
    // package merely because its name is assembled outside this file.
    if (!first || staticString(first) === null) {
      return [...HTML_PACKAGES];
    }
  }

  return [...references];
}

export function manifestPackageReferences(value: SgNode<Js>, shellScripts: boolean): string[] {
  const references = new Set<string>();

  for (const node of value.findAll({ rule: { kind: "string" } })) {
    // This node comes from the JSON parser. JSON.parse only decodes its literal
    // value; it cannot execute scripts embedded in package.json.
    const text = JSON.parse(node.text()) as string;
    // npm scripts contain shell commands rather than JavaScript AST nodes.
    // Keep their decoded contents conservative, including embedded node -e/-p.
    const packages = shellScripts
      ? HTML_PACKAGES.filter((name) => text.includes(name))
      : packagesInRequest(text);

    for (const name of packages) {
      references.add(name);
    }
  }

  return [...references];
}

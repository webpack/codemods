import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import { findPair, guardBranchesOf, keyName, loaderNameOf, namedChildren, pairsOf } from "@webpack/codemod-utils";
import { collectMinification, type Minification } from "../minification";
import type { HtmlProp } from "../config-plan";
import { isIdentityCallback } from "./callbacks";
import { nativeSources } from "./sources";
import { nativeTemplate } from "./template";

export const LOADER_NAME = "html-loader";

// Loader options translated into the surviving rule and migration eligibility.
export interface LoaderFindings {
  supported: boolean;
  sourceDefaults: boolean;
  parserProps: HtmlProp[];
  minification: Minification[];
}

// Translate known equivalents; retain the config when an option would lose
// executable behavior or change the module's export contract.
export function collectLoaderFindings(node: SgNode<Js>, findings: LoaderFindings, typescript: boolean): void {
  const branches = guardBranchesOf(node);
  if (branches) {
    for (const branch of branches) collectLoaderFindings(branch, findings, typescript);
    return;
  }
  if (!node.is("object") || loaderNameOf(node) !== LOADER_NAME) return;
  const optionsValue = findPair(node, "options")?.field("value");
  const minification = collectMinification(
    optionsValue?.is("object") ? findPair(optionsValue, "minimize")?.field("value") : undefined,
    `${LOADER_NAME}.minimize`,
  );
  findings.minification.push(minification);
  if (minification.lost.length) findings.supported = false;
  if (!optionsValue) return;
  if (!optionsValue.is("object")) {
    findings.supported = false;
    return;
  }
  if (namedChildren(optionsValue).some((child) => !child.is("pair") && !child.is("comment"))) {
    findings.supported = false;
    return;
  }
  for (const optionPair of pairsOf(optionsValue)) {
    const name = keyName(optionPair);
    const value = optionPair.field("value");
    if (name === "esModule") {
      // Native HTML exposes a default string export and its CJS shim also
      // returns that string directly, so both literal settings can migrate.
      if (!value?.is("true") && !value?.is("false")) findings.supported = false;
      continue;
    }
    if (name === "minimize") continue;
    if (name === "sources" && value) {
      const sources = nativeSources(value, typescript);
      if (sources === null) findings.supported = false;
      else {
        findings.parserProps.push({ name: "sources", valueText: sources.text });
        findings.sourceDefaults ||= sources.extendsDefaults;
      }
      continue;
    }
    if (name === "preprocessor" && value) {
      const template = nativeTemplate(value, typescript);
      if (template === null) findings.supported = false;
      else findings.parserProps.push({ name: "template", valueText: template });
      continue;
    }
    if (name === "postprocessor" && value && isIdentityCallback(value)) continue;
    findings.supported = false;
  }
}

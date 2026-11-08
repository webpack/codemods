import type Js from "@codemod.com/jssg-types/langs/javascript";
import type { SgNode } from "@codemod.com/jssg-types/main";
import {
  ConfigEditor,
  cascadeRemovalTarget,
  filterSuffixOf,
  findConfigObjectFor,
  findPair,
  guardBranchesOf,
  keyName,
  lineIndent,
  loaderNameOf,
  namedChildren,
  pairsOf,
  parseExpression,
  ruleMatchesFiles,
  sameSyntax,
  unwrapFilterCall,
} from "@webpack/codemod-utils";
import { ConfigPlans, dedupeProps } from "../config-plan";
import { collectLoaderFindings, LOADER_NAME, type LoaderFindings } from "./options";

const HTML_SAMPLE_FILES = ["/file.html"];

function isDefaultHtmlTest(node: SgNode<Js> | null | undefined): boolean {
  if (!node?.is("regex")) {
    return false;
  }

  const flags = node.field("flags")?.text() ?? "";

  return node.field("pattern")?.text() === "\\.html$" && (flags === "" || flags === "i");
}

interface RuleMigration {
  pair: SgNode<Js>;
  ruleObject: SgNode<Js>;
  kept: SgNode<Js>[];
  filterSuffix: string;
  findings: LoaderFindings;
  trivial: boolean;
  optionsPair: SgNode<Js> | null;
}

export class HtmlLoaderRules {
  private readonly typescript: boolean;

  private readonly editor: ConfigEditor;
  private readonly plans: ConfigPlans;
  private readonly blockedConfigs: Set<number>;

  constructor(editor: ConfigEditor, plans: ConfigPlans, blockedConfigs: Set<number>) {
    this.editor = editor;
    this.plans = plans;
    this.blockedConfigs = blockedConfigs;

    this.typescript = /\.[cm]?tsx?$/.test(editor.rootNode.getRoot().filename());
  }

  // A `use` entry replaceable by native HTML, unwrapping dev/prod guards.
  private isRemovableUseElement(node: SgNode<Js>): boolean {
    const branches = guardBranchesOf(node);

    if (branches) {
      return branches.length > 0 && branches.every((branch) => this.isRemovableUseElement(branch));
    }

    return loaderNameOf(node) === LOADER_NAME;
  }

  // Webpack owns the rule when its array hangs on a `rules`/`oneOf` pair or
  // the config has a `module` ancestor — never fragments pushed into another
  // tool's config (Storybook, craco, …).
  private isWebpackRuleContext(pair: SgNode<Js>, arrayNode: SgNode<Js>): boolean {
    const owner = arrayNode.parent();

    if (owner && owner.is("pair")) {
      const name = keyName(owner);

      if (name === "rules" || name === "oneOf") {
        return true;
      }
    }

    return findConfigObjectFor(pair) !== null;
  }

  // Trivial html-loader rules are dropped (the `experiments.html: "auto"`
  // default takes over); surviving rules get `type: "html"` and turn the
  // default off, so `experiments.html: true` is added to their config.
  transformRules(usePairs: SgNode<Js>[], loaderPairs: SgNode<Js>[]): void {
    const migrations: RuleMigration[] = [];

    for (const pair of usePairs) {
      const originalValue = pair.field("value");

      if (!originalValue) {
        continue;
      }

      const value = unwrapFilterCall(originalValue);
      const elements = value.is("array") ? namedChildren(value) : [value];

      if (!elements.length) {
        continue;
      }

      // Any other loader (template compilers, custom ones) stays in front.
      const kept = elements.filter((element) => !this.isRemovableUseElement(element));

      if (kept.length === elements.length) {
        continue;
      }

      const ruleObject = pair.parent();

      if (!ruleObject || !ruleObject.is("object")) {
        continue;
      }

      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) {
        continue;
      }

      const findings: LoaderFindings = {
        supported: true,
        sourceDefaults: false,
        parserProps: [],
        minification: [],
      };

      for (const element of elements) {
        collectLoaderFindings(element, findings, this.typescript);
      }

      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);

        return name === "test" || name === "use";
      });

      migrations.push({
        pair,
        ruleObject,
        kept,
        filterSuffix: filterSuffixOf(originalValue, value),
        findings,
        trivial,
        optionsPair: null,
      });
    }

    // Rule-level `loader:`/`options:` shorthand.
    for (const pair of loaderPairs) {
      const ruleObject = pair.parent();

      if (!ruleObject || !ruleObject.is("object")) {
        continue;
      }

      if (!findPair(ruleObject, "test") || findPair(ruleObject, "use")) {
        continue;
      }

      const value = pair.field("value");

      if (!value || !this.isRemovableUseElement(value)) {
        continue;
      }

      if (!this.isWebpackRuleContext(pair, ruleObject.parent() ?? ruleObject)) {
        continue;
      }

      const findings: LoaderFindings = {
        supported: true,
        sourceDefaults: false,
        parserProps: [],
        minification: [],
      };

      collectLoaderFindings(ruleObject, findings, this.typescript);

      const trivial = pairsOf(ruleObject).every((rulePair) => {
        const name = keyName(rulePair);

        return name === "test" || name === "loader" || name === "options";
      });

      migrations.push({
        pair,
        ruleObject,
        kept: [],
        filterSuffix: "",
        findings,
        trivial,
        optionsPair: findPair(ruleObject, "options") ?? null,
      });
    }

    // A retained html-loader emits JavaScript. Enabling native HTML or replacing
    // an HTML plugin's template beside it would parse that JavaScript as HTML.
    // Decide this before making edits to any of the owning config's rules.
    for (const migration of migrations) {
      if (this.canMigrateRule(migration)) {
        continue;
      }

      const config = findConfigObjectFor(migration.pair);

      if (config) {
        this.blockedConfigs.add(config.range().start.index);
      }
    }

    for (const migration of migrations) {
      this.applyRuleMigration(migration);
    }
  }

  private canMigrateRule(swap: RuleMigration): boolean {
    if (!swap.findings.supported) {
      return false;
    }

    const config = findConfigObjectFor(swap.pair);
    const experiments = config && findPair(config, "experiments")?.field("value");
    const parser = findPair(swap.ruleObject, "parser")?.field("value");

    if (
      (experiments && !experiments.is("object")) ||
      (swap.findings.parserProps.length && parser && !parser.is("object"))
    ) {
      return false;
    }

    // Do not replace loader behavior with a conflicting existing parser option,
    // or flatten differently configured loader branches into one parser.
    for (const prop of swap.findings.parserProps) {
      const existing = parser?.is("object")
        ? findPair(parser, prop.name)?.field("value")
        : undefined;
      const replacement = parseExpression(prop.valueText);

      if (existing && !sameSyntax(existing, replacement)) {
        return false;
      }

      if (
        swap.findings.parserProps.some(
          (other) =>
            other.name === prop.name && !sameSyntax(parseExpression(other.valueText), replacement),
        )
      ) {
        return false;
      }
    }

    return (
      !swap.findings.sourceDefaults || (!!config && this.plans.canNormalizeSourceDefaults(config))
    );
  }

  private applyRuleMigration(swap: RuleMigration): void {
    if (!this.canMigrateRule(swap)) {
      return;
    }

    const config = findConfigObjectFor(swap.pair);

    if (config && this.blockedConfigs.has(config.range().start.index)) {
      return;
    }

    const experiments = config && findPair(config, "experiments")?.field("value");
    const parser = findPair(swap.ruleObject, "parser")?.field("value");

    swap.findings.parserProps = dedupeProps(swap.findings.parserProps);

    if (swap.findings.sourceDefaults && config) {
      this.plans.planFor(config).sourceDefaults = true;
    }

    if (config) {
      this.plans
        .planFor(config)
        .minification.push(
          ...(swap.findings.minification.length
            ? swap.findings.minification
            : [{ html: null, lost: [] }]),
        );
    }

    const survives =
      !swap.trivial ||
      !isDefaultHtmlTest(findPair(swap.ruleObject, "test")?.field("value")) ||
      swap.kept.length > 0 ||
      swap.findings.parserProps.length > 0;

    if (!survives) {
      // Explicitly disabled HTML must be enabled even when its loader rule goes.
      if (config && experiments && findPair(experiments, "html")) {
        this.plans.requireExperimentsHtml(this.plans.planFor(config));
      }

      this.editor.markForRemoval(cascadeRemovalTarget(swap.ruleObject));

      return;
    }

    const indent = lineIndent(this.editor.source, swap.pair.range().start.index);
    const multiline = swap.ruleObject.range().start.line !== swap.ruleObject.range().end.line;
    const separator = multiline ? `,\n${indent}` : ", ";
    let replacement = "";

    if (swap.kept.length) {
      // Guarded entries keep the original `.filter(...)` for their falsy branch.
      const keptTexts = swap.kept.map((loader) => loader.text());
      const keepsGuard = swap.kept.some((loader) => guardBranchesOf(loader) !== null);
      const filterSuffix = keepsGuard ? swap.filterSuffix || ".filter(Boolean)" : "";

      replacement += `use: [${keptTexts.join(", ")}]${filterSuffix}${separator}`;
    }

    const typePair = findPair(swap.ruleObject, "type");

    replacement += `type: "html"`;

    if (typePair) {
      this.editor.markForRemoval(typePair);
    }

    if (swap.findings.parserProps.length) {
      if (parser?.is("object")) {
        const missing = swap.findings.parserProps.filter((prop) => !findPair(parser, prop.name));

        if (missing.length) {
          this.editor.insertIntoObject(parser, () =>
            missing.map((prop) => `${prop.name}: ${prop.valueText}`),
          );
        }
      } else if (!parser) {
        const texts = swap.findings.parserProps.map((prop) => `${prop.name}: ${prop.valueText}`);

        replacement += `${separator}parser: { ${texts.join(", ")} }`;
      }
    }

    this.editor.replace(swap.pair, replacement);

    if (swap.optionsPair) {
      this.editor.markForRemoval(swap.optionsPair);
    }

    // A surviving rule that matches `.html` turns the "auto" default off.
    if (!ruleMatchesFiles(swap.ruleObject, HTML_SAMPLE_FILES)) {
      return;
    }

    if (config) {
      this.plans.requireExperimentsHtml(this.plans.planFor(config));
    }
  }
}

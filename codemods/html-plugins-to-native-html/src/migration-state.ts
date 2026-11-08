import type {} from "@codemod.com/jssg-types/workflow";
import { acquireLock, getState, setState } from "codemod:workflow";

const SOURCES_KEY = "webpack-native-html:sources";
const TEMPLATES_KEY = "webpack-native-html:templates";

export interface TemplateScript {
  src: string;
  chunkName?: string;
}

// Use one spelling for filenames from the JS, HTML and JSON parsers, including
// Windows filenames. Resolving these paths never opens or writes a file.
export function normalizeFilename(filename: string): string {
  const segments: string[] = [];

  for (const part of filename
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (part === ".") {
      continue;
    }

    if (part === ".." && segments.length && segments.at(-1) !== "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }

  return segments.join("/");
}

export function directoryOf(filename: string): string {
  const normalized = normalizeFilename(filename);
  const slash = normalized.lastIndexOf("/");

  return slash < 0 ? "." : normalized.slice(0, slash);
}

export function recordSource(filename: string, references: string[]): void {
  const release = acquireLock(SOURCES_KEY);

  try {
    const sources = getState<Record<string, string[]>>(SOURCES_KEY) ?? {};

    sources[normalizeFilename(filename)] = references;
    setState(SOURCES_KEY, sources);
  } finally {
    release();
  }
}

export function remainingPackages(manifestFilename: string): Set<string> | null {
  const sources = getState<Record<string, string[]>>(SOURCES_KEY);

  // Running the JSON transform alone provides no evidence for safe removal.
  if (!sources) {
    return null;
  }

  const directory = directoryOf(manifestFilename);
  const remaining = new Set<string>();

  for (const [filename, packages] of Object.entries(sources)) {
    if (directory !== "." && !filename.startsWith(`${directory}/`)) {
      continue;
    }

    for (const name of packages) {
      remaining.add(name);
    }
  }

  return remaining;
}

export function queueTemplate(
  configFilename: string,
  template: string,
  entry: string,
  chunkName: string,
): string | null {
  if (!template.startsWith(".") || !entry.startsWith(".")) {
    return null;
  }

  const directory = directoryOf(configFilename);
  const templateFilename = normalizeFilename(`${directory}/${template}`);
  const entryFilename = normalizeFilename(`${directory}/${entry}`);
  const from = directoryOf(templateFilename).split("/");
  const to = entryFilename.split("/");
  let common = 0;

  while (common < from.length && common < to.length - 1 && from[common] === to[common]) {
    common += 1;
  }

  const up = from.length - common;
  const script = `${up ? "../".repeat(up) : "./"}${to.slice(common).join("/")}`;
  const release = acquireLock(TEMPLATES_KEY);

  try {
    const templates = getState<Record<string, TemplateScript[]>>(TEMPLATES_KEY) ?? {};
    const scripts = templates[templateFilename] ?? [];

    if (!scripts.some((item) => item.src === script && item.chunkName === chunkName)) {
      scripts.push({ src: script, chunkName });
    }

    templates[templateFilename] = scripts.sort(
      (a, b) => a.src.localeCompare(b.src) || (a.chunkName ?? "").localeCompare(b.chunkName ?? ""),
    );
    setState(TEMPLATES_KEY, templates);
  } finally {
    release();
  }

  return script;
}

export function scriptsForTemplate(filename: string): TemplateScript[] {
  return (
    getState<Record<string, TemplateScript[]>>(TEMPLATES_KEY)?.[normalizeFilename(filename)] ?? []
  );
}

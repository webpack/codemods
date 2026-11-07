import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export function fixture(name, file = "expected.js") {
  const module = { exports: {} };
  const code = readFileSync(new URL(`./${name}/${file}`, import.meta.url), "utf8");
  new Function("module", code.replace("export default", "module.exports ="))(module);
  return module.exports.module.rules[0];
}

test("source filter adapter preserves attribute decisions and captured bindings", () => {
  for (const name of ["loader-sources-filter", "loader-sources-attributes-filter", "loader-sources-filter-capture"]) {
    const oldFilter = fixture(name, "input.js").options.sources.list.at(-1).filter;
    const newFilter = fixture(name).parser.sources.at(-1).filter;
    for (const attrs of [[], [{ name: "data-local", value: "yes" }], [{ name: "data-local", value: "no" }]]) {
      assert.equal(newFilter(new Map(attrs.map(({ name, value }) => [name, value])), "./image.png"), oldFilter("img", "src", attrs, "/src/index.html"));
    }
  }
});

test("URL filter adapter receives individual normalized src values", () => {
  const oldFilter = fixture("loader-sources-url-filter-explicit", "input.mjs").options.sources.urlFilter;
  const newFilter = fixture("loader-sources-url-filter-explicit", "expected.mjs").parser.sources[0].filter;
  for (const [raw, normalized] of [["./image.png", "./image.png"], [" /external.png \n", "/external.png"], ["\u0001/local.png\u00a0", "/local.png"]]) {
    assert.equal(newFilter(new Map(), raw), oldFilter("src", normalized, "/src/index.html"));
  }
});

test("template context migration preserves resource parts, including escaped delimiters", () => {
  const before = fixture("loader-preprocessor-resource-parts", "input.js").options.preprocessor;
  const after = fixture("loader-preprocessor-resource-parts").parser.template;
  for (const [resource, resourcePath, resourceQuery, resourceFragment] of [
    ["/src/index.html", "/src/index.html", "", ""],
    ["/src/index.html?theme=dark#top", "/src/index.html", "?theme=dark", "#top"],
    ["/src/a\0?b.html?theme\0#dark#top", "/src/a?b.html", "?theme#dark", "#top"],
  ]) {
    assert.equal(after("HTML", { resource, module: { context: "/src" } }), before("HTML", { resource, resourcePath, resourceQuery, resourceFragment, context: "/src" }));
  }
});

test("template migration preserves dependency registration and warnings", () => {
  const before = fixture("loader-preprocessor-dependencies", "input.js").options.preprocessor;
  const after = fixture("loader-preprocessor-dependencies").parser.template;
  const invoke = (fn) => {
    const events = [];
    const html = fn("  <p>HTML</p>  ", {
      addDependency: (file) => events.push(["dependency", file]),
      emitWarning: (error) => events.push(["warning", error.message]),
    });
    return { html, events };
  };
  assert.deepEqual(invoke(after), invoke(before));
});

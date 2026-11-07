---
"@webpack/html-plugins-to-native-html": patch
---

Handle both literal esModule settings and remove identity postprocessors. Preserve configurations with unsupported loader callbacks, postprocessors, minifier options or conflicting parser settings, avoiding partial migrations that parse loader-generated JavaScript as HTML. Document coverage for every public html-loader option.

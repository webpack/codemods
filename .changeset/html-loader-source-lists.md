---
"@webpack/html-plugins-to-native-html": patch
---

Migrate static html-loader sources.list arrays to parser.sources, preserving default entries, custom src/srcset attributes, and unrelated parser options. Retain rules with incompatible callbacks, dynamic settings, or conflicting parser options.

---
"@webpack/html-plugins-to-native-html": patch
---

Migrate synchronous inline html-loader preprocessors with known string results to parser.template. Keep asynchronous, context-dependent, and unknown transformations intact for manual adaptation.

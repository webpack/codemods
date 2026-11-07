---
"@webpack/html-plugins-to-native-html": patch
---

Normalize native HTML source defaults to an array when a migrated rule extends them with "...", avoiding an invalid boolean entry during webpack parser option merging. Keep existing custom or disabled global sources for manual integration.

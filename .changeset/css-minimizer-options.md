---
"@webpack/css-plugins-to-native-css": patch
---

Migrate supported css-minimizer-webpack-plugin options from cssnano's default preset to webpack's native CSS minifier. Preserve the build's minimize switch, other asset types, custom minimizers, and compatible native settings; retain unsupported or conflicting configurations for manual migration.

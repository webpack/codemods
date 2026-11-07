---
"@webpack/html-plugins-to-native-html": major
---

Add a codemod migrating html-webpack-plugin and html-loader to webpack 5.110.0+ native HTML support and minification. Translate supported minification options, preserve existing configuration and still-used dependencies, and leave unsupported template/multi-page setups for manual migration.

Apply template and dependency changes through AST workflow steps coordinated by shared state, without filesystem APIs or permissions; preserve dry-run behavior and idempotence.

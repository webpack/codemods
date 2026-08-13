# migrate-library-target-to-library-object

This codemod migrates the `output.library` and `output.libraryTarget` properties in Webpack configurations to the new format required by Webpack 5. It changes `output.library` to `output.library.name` and `output.libraryTarget` to `output.library.type`.

## Example

```diff
- module.exports = {
-   output: {
-     library: "MyLibrary",
-     libraryTarget: "commonjs2",
-   },
- };
+ module.exports = {
+   output: {
+     library: {
+       name: "MyLibrary",
+       type: "commonjs2",
+     },
+   },
+ };
```

```diff
- module.exports = {
-   output: {
-     library: "MyLibrary",
-     libraryTarget: "commonjs2",
-     filename: "bundle.js",
-   },
- };
+ module.exports = {
+   output: {
+     library: {
+       name: "MyLibrary",
+       type: "commonjs2",
+     },
+
+     filename: "bundle.js",
+   },
+ };
```

```diff
- module.exports = {
-   output: {
-     library: "MyLibrary",
-   },
- };
+ module.exports = {
+   output: {
+     library: {
+       name: "MyLibrary",
+       type: undefined,
+     },
+   },
+ };
```

```diff
- module.exports = {
-   output: {
-     library: "MyLibrary",
-     libraryTarget: "umd",
-     path: "./dist",
-   },
- };
+ module.exports = {
+   output: {
+     library: {
+       name: "MyLibrary",
+       type: "umd",
+     },
+
+     path: "./dist",
+   },
+ };
```

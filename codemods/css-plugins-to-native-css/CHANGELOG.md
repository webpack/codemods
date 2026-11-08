# @webpack/css-plugins-to-native-css

## 1.0.1

### Patch Changes

- ca16efc: Migrate supported css-minimizer-webpack-plugin options from cssnano's default preset to webpack's native CSS minifier. Preserve the build's minimize switch, other asset types, custom minimizers, and compatible native settings; retain unsupported or conflicting configurations for manual migration.

## 1.0.0

### Major Changes

- 5eb74e5: Add codemod migrating mini-css-extract-plugin and style-loader/css-loader setups to webpack's native CSS support.

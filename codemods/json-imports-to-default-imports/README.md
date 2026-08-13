# json-imports-to-default-imports

This codemod migrates imports from JSON modules that use named exports to use default exports instead.

This codemod transforms named imports from JSON files into default imports, adhering to the new ECMAScript specification and Webpack v5 compatibility. Named imports from JSON modules are no longer supported.

[Official Documentation](https://webpack.js.org/migrate/5/#using-named-exports-from-json-modules)

## Examples

```diff
- import { version } from "./package.json";
- console.log(version);
+ import pkg from "./package.json";
+ console.log(pkg.version);
```

```diff
- import { version, name, description } from "./package.json";
- console.log(version, name, description);
+ import pkg from "./package.json";
+ console.log(pkg.version, pkg.name, pkg.description);
```

```diff
- import { data } from './config.json';
- console.log(data.nested.key, data.anotherKey);
+ import config from './config.json';
+ console.log(config.data.nested.key, config.data.anotherKey);
```

```diff
- import { key1, key2 } from './config.json';
- console.log(key1, key2);
+ import config from './config.json';
+ console.log(config.key1, config.key2);
```

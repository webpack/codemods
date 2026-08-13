import type { Codemod, Edit } from "codemod:ast-grep";
import type Js from "@codemod.com/jssg-types/langs/javascript";


const transform: Codemod<Js> = async (root) => {
	const rootNode = root.root();
	const edits: Edit[] = [];

	// Find all import statements from JSON files
	const allImportStatements = rootNode.findAll({
		rule: {
			kind: "import_statement",
		},
	});

	// Track transformations to apply identifier replacements
	const transformations: Array<{
		importedNames: string[];
		defaultImportName: string;
		importPath: string;
	}> = [];

	for (const importStatement of allImportStatements) {
		// Check if this import has a string source ending with .json
		const sourceStrings = importStatement.findAll({
			rule: {
				kind: "string",
			},
		});

		if (sourceStrings.length === 0) continue;

		const sourceString = sourceStrings[0];
		const sourceText = sourceString.text();
		const importPath = sourceText.slice(1, -1);

		if (!importPath.endsWith(".json")) continue;

		// Check if this import has named imports
		const namedImports = importStatement.findAll({
			rule: {
				kind: "named_imports",
			},
		});

		if (namedImports.length === 0) continue;

		// Extract import specifiers
		const importSpecifiers = importStatement.findAll({
			rule: {
				kind: "import_specifier",
			},
		});

		if (importSpecifiers.length === 0) continue;

		// Extract the names of imported identifiers
		const importedNames: string[] = [];
		for (const specifier of importSpecifiers) {
			const identifiers = specifier.findAll({
				rule: {
					kind: "identifier",
				},
			});

			if (identifiers.length > 0) {
				const localName = identifiers[identifiers.length - 1].text();
				importedNames.push(localName);
			}
		}

		if (importedNames.length === 0) continue;

		// Generate default import name
		const importBaseName = importPath.split("/").pop()?.replace(".json", "") || "config";
		const defaultImportName = importBaseName === "package" ? "pkg" : importBaseName;

		edits.push(importStatement.replace(`import ${defaultImportName} from ${sourceText};`));

		// Track this transformation for identifier replacement
		transformations.push({
			importedNames,
			defaultImportName,
			importPath,
		});
	}

	// Replace all usages of the imported identifiers with property access
	for (const { importedNames, defaultImportName } of transformations) {
		for (const importedName of importedNames) {
			// Find all identifiers with this exact name
			const identifiers = rootNode.findAll({
				rule: {
					kind: "identifier",
					regex: `^${escapeRegex(importedName)}$`,
				},
			});

			for (const identifier of identifiers) {
				// Skip if this identifier is part of an import statement
				const isInImportStatement = identifier.inside({
					rule: {
						kind: "import_statement",
					},
				});

				if (isInImportStatement) continue;

				// Replace with property access
				edits.push(identifier.replace(`${defaultImportName}.${importedName}`));
			}
		}
	}

	if (!edits.length) return null;

	return rootNode.commitEdits(edits);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default transform;

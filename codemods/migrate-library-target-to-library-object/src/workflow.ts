import type { Codemod, Edit } from "codemod:ast-grep";
import type Js from "@codemod.com/jssg-types/langs/javascript";

const transform: Codemod<Js> = async (root) => {
	const rootNode = root.root();
	const edits: Edit[] = [];

	// Find all module.exports assignments
	const moduleExports = rootNode.findAll({
		rule: {
			kind: "assignment_expression",
			has: {
				kind: "member_expression",
				has: {
					field: "object",
					kind: "identifier",
					regex: "^module$",
				},
			},
		},
	});

	for (const moduleExport of moduleExports) {
		// Find the right side of the assignment (the configuration object)
		const rightSide = moduleExport.find({
			rule: {
				kind: "object",
			},
		});

		if (!rightSide) continue;

		// Find the output property
		const outputProperty = rightSide.find({
			rule: {
				kind: "pair",
				has: {
					field: "key",
					kind: "property_identifier",
					regex: "^output$",
				},
			},
		});

		if (!outputProperty) continue;

		// Find the output object value
		const outputObject = outputProperty.find({
			rule: {
				kind: "object",
			},
		});

		if (!outputObject) continue;

		// Find library and libraryTarget properties
		const libraryProperty = outputObject.find({
			rule: {
				kind: "pair",
				has: {
					field: "key",
					kind: "property_identifier",
					regex: "^library$",
				},
			},
		});

		const libraryTargetProperty = outputObject.find({
			rule: {
				kind: "pair",
				has: {
					field: "key",
					kind: "property_identifier",
					regex: "^libraryTarget$",
				},
			},
		});

		if (!libraryProperty) continue;

		// Get the library value
		const libraryValue = libraryProperty.find({
			rule: {
				kind: "string",
			},
		});

		if (!libraryValue) continue;

		const libraryName = libraryValue.text();

		// Get the libraryTarget value if it exists
		let libraryType = "undefined";
		if (libraryTargetProperty) {
			const libraryTargetValue = libraryTargetProperty.find({
				rule: {
					kind: "string",
				},
			});
			if (libraryTargetValue) {
				libraryType = libraryTargetValue.text();
			}
		}

		// Get all properties in the output object to reconstruct it properly
		const allProperties = outputObject.findAll({
			rule: {
				kind: "pair",
			},
		});

		// Build new output object content with preserved tabs and trailing commas per property
		const newProperties: string[] = [];

		for (const property of allProperties) {
			const keyNode = property.find({
				rule: {
					kind: "property_identifier",
				},
			});

			if (!keyNode) continue;

			const keyName = keyNode.text();

			if (keyName === "library") {
				// Replace with new library object, keep trailing comma
				newProperties.push(
					`library: {\n\t\t\tname: ${libraryName},\n\t\t\ttype: ${libraryType === "undefined" ? "undefined" : libraryType},\n\t\t},`,
				);
			} else if (keyName === "libraryTarget") {
				// Skip libraryTarget property - it's being moved into library.type
				// (no-op)
			} else {
				// Keep other properties and add trailing comma
				newProperties.push(`${property.text()},`);
			}
		}

		// Replace the entire output object with tab-indented content to match source style
		const newOutputObject = `{\n\t\t${newProperties.join("\n\t\t")}\n\t}`;

		edits.push(outputObject.replace(newOutputObject));
	}

	if (!edits.length) return null;

	return rootNode.commitEdits(edits);
}

export default transform;

import type { Codemod, Edit } from "codemod:ast-grep";
import type Js from "@codemod.com/jssg-types/langs/javascript";


const transform: Codemod<Js> = async (root) => {
	const rootNode = root.root();
	const edits: Edit[] = [];

	// Find all pairs in the code
	const pairs = rootNode.findAll({
		rule: {
			kind: "pair",
		},
	});

	for (const pair of pairs) {
		const pairText = pair.text();

		// Check if this is a target property with a call expression
		if (pairText.startsWith("target:")) {
			// Find call expressions in this pair
			const callExpressions = pair.findAll({
				rule: {
					kind: "call_expression",
				},
			});

			if (callExpressions.length > 0) {
				const callExpressionText = callExpressions[0].text();

				// Replace this pair with both target: false and plugins array
				edits.push(pair.replace(`target: false,\n\tplugins: [${callExpressionText}]`));
			}
		}
	}

	if (!edits.length) return null;

	return rootNode.commitEdits(edits);
}

export default transform;
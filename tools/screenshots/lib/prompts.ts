/**
 * Prompt template rendering.
 *
 * Templates contain `{{name}}` tokens that get substituted with values
 * from the `vars` map. Token matching is exact — `{{ name }}` (with
 * whitespace) is a different token from `{{name}}`. This keeps rendering
 * deterministic and prevents accidental fuzzy matches.
 *
 * Test contract: tools/screenshots/lib/__tests__/prompts.test.ts.
 */

// Tokens are exactly `{{name}}` — no internal whitespace. `{{ name }}`
// is intentionally NOT matched; it stays as literal text in the output.
// This keeps rendering deterministic and prevents accidental fuzzy
// matches. See prompts.test.ts for the pin.
const TOKEN_PATTERN = /\{\{([^\s}]+)\}\}/g;

/**
 * Render a prompt template by substituting `{{name}}` tokens.
 *
 * @throws when one or more tokens have no value in `vars`. The error
 *   lists ALL missing tokens, not just the first, so the author can fix
 *   them in one pass.
 */
export function renderPrompt(
	template: string,
	vars: Record<string, string>,
): string {
	const missing: string[] = [];

	const result = template.replace(TOKEN_PATTERN, (match, key: string) => {
		if (Object.prototype.hasOwnProperty.call(vars, key)) {
			return vars[key];
		}
		missing.push(key);
		return match;
	});

	if (missing.length > 0) {
		const unique = Array.from(new Set(missing));
		throw new Error(
			`prompt template references undefined variables: ${unique.join(", ")}`,
		);
	}

	return result;
}

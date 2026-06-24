/**
 * Prompt-file parser.
 *
 * Parses a prompt-library markdown file into a validated `PromptDefinition`.
 * The frontmatter block (parsed by Obsidian's `parseYaml`, injected by the
 * caller so this module stays free of the `obsidian` runtime) declares the
 * launch metadata; everything after the frontmatter is the prompt body.
 *
 * Pure and collect-all (every problem reported), so it is unit-testable in
 * isolation and the caller can log all issues for a malformed file at once.
 */

import type { PromptDefinition, PromptParseResult } from "../types/prompt";

/**
 * Split a markdown file into its YAML frontmatter source and body.
 *
 * Recognizes a leading `---` … `---` fence (the Obsidian/Jekyll convention).
 * Returns `frontmatter: null` when no fence is present (body is the whole file).
 * Tolerates leading blank lines before the opening fence.
 */
export function splitFrontmatter(content: string): {
	frontmatter: string | null;
	body: string;
} {
	// Normalize newlines so the fence regex behaves the same on CRLF files.
	const normalized = content.replace(/\r\n/g, "\n");
	const match = /^\s*---\n([\s\S]*?)\n---\n?/.exec(normalized);
	if (!match) {
		return { frontmatter: null, body: normalized.trim() };
	}
	const frontmatter = match[1];
	const body = normalized.slice(match[0].length).trim();
	return { frontmatter, body };
}

/**
 * Parse a prompt file's raw text into a validated definition.
 *
 * @param path         Vault-relative path (identity + error context).
 * @param content      Full file text (frontmatter + body).
 * @param parseYaml    Injected YAML parser (Obsidian's `parseYaml`).
 * @param knownAgentIds Configured agent ids. When non-empty, an unknown
 *                      `agent` is an error; when empty, the check is skipped.
 */
export function parsePromptFile(
	path: string,
	content: string,
	parseYaml: (yaml: string) => unknown,
	knownAgentIds: readonly string[] = [],
): PromptParseResult {
	const errors: string[] = [];

	const { frontmatter, body } = splitFrontmatter(content);

	if (frontmatter === null) {
		return {
			ok: false,
			errors: [
				`${path}: missing YAML frontmatter (a leading --- … --- block declaring at least \`agent\`).`,
			],
		};
	}

	let raw: unknown;
	try {
		raw = parseYaml(frontmatter);
	} catch (error) {
		return {
			ok: false,
			errors: [
				`${path}: could not parse frontmatter: ${
					error instanceof Error ? error.message : String(error)
				}`,
			],
		};
	}

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			errors: [
				`${path}: frontmatter must be a set of key: value properties.`,
			],
		};
	}

	const fm = raw as Record<string, unknown>;

	// --- agent (required) ---
	const agent = requireString(fm.agent, "agent", path, errors);
	if (
		agent !== null &&
		knownAgentIds.length > 0 &&
		!knownAgentIds.includes(agent)
	) {
		errors.push(
			`${path}: unknown agent "${agent}". Configure it in Agent Console settings, or use one of: ${knownAgentIds.join(", ")}.`,
		);
	}

	// --- name (optional, falls back to filename basename) ---
	const name = optionalString(fm.name, "name", path, errors);

	// --- description (optional, falls back to name/basename at the call site) ---
	const description = optionalString(
		fm.description,
		"description",
		path,
		errors,
	);

	// --- model / mode (optional) ---
	const model = optionalString(fm.model, "model", path, errors);
	const mode = optionalString(fm.mode, "mode", path, errors);

	// --- tags (optional; normalized, leading # stripped) ---
	const tags = parseTags(fm.tags, path, errors);

	// --- body (the prompt; required, non-empty) ---
	if (body.trim() === "") {
		errors.push(
			`${path}: the prompt body (text after the frontmatter) is empty.`,
		);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const basename = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
	const resolvedName = name ?? basename;

	const definition: PromptDefinition = {
		path,
		name: resolvedName,
		description: description ?? resolvedName,
		prompt: body,
		// agent is non-null here: requireString only returns null after pushing
		// an error, and we returned early above when errors exist.
		agent: agent as string,
		model: model ?? undefined,
		mode: mode ?? undefined,
		tags,
	};
	return { ok: true, prompt: definition };
}

/** Require a non-empty string field. Pushes an error + returns null on failure. */
function requireString(
	value: unknown,
	field: string,
	path: string,
	errors: string[],
): string | null {
	if (value === undefined || value === null) {
		errors.push(`${path}: missing required field \`${field}\`.`);
		return null;
	}
	if (typeof value !== "string") {
		errors.push(`${path}: \`${field}\` must be a string.`);
		return null;
	}
	const trimmed = value.trim();
	if (trimmed === "") {
		errors.push(`${path}: \`${field}\` must not be empty.`);
		return null;
	}
	return trimmed;
}

/**
 * Read an optional string field. Missing/null → null (no error). A non-string
 * is an error; a blank string is treated as absent (null).
 */
function optionalString(
	value: unknown,
	field: string,
	path: string,
	errors: string[],
): string | null {
	if (value === undefined || value === null) return null;
	// YAML may parse a bare number/identifier as non-string (e.g. model: 4.6).
	if (typeof value === "number") return String(value);
	if (typeof value !== "string") {
		errors.push(`${path}: \`${field}\` must be a string.`);
		return null;
	}
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * Normalize the `tags` field into a deduped string[] (leading `#` stripped).
 * Accepts omitted/null (→ []), a single tag string, or a list of tags. A
 * comma/space-separated single string is also split, matching how users often
 * write `tags: a, b`.
 */
function parseTags(value: unknown, path: string, errors: string[]): string[] {
	if (value === undefined || value === null) return [];

	const collect = (entries: unknown[]): string[] => {
		const out: string[] = [];
		for (const entry of entries) {
			if (typeof entry !== "string") {
				errors.push(`${path}: \`tags\` entries must be strings.`);
				return [];
			}
			for (const t of entry.split(/[,\s]+/)) {
				const tag = t.trim().replace(/^#/, "");
				if (tag !== "" && !out.includes(tag)) out.push(tag);
			}
		}
		return out;
	};

	if (typeof value === "string") return collect([value]);
	if (Array.isArray(value)) return collect(value);

	errors.push(`${path}: \`tags\` must be a tag or a list of tags.`);
	return [];
}

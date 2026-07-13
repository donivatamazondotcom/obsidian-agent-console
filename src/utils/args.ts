/**
 * Agent argument parsing/formatting (the Arguments settings field).
 *
 * The Arguments textarea historically split on newlines ONLY, so a user who
 * typed a whole command line on one line — e.g. `acp --agent my-agent` — got a
 * single argv token `"acp --agent my-agent"`, which the agent process cannot
 * interpret. The handshake then fails opaquely ("ACP connection closed"). Every
 * copy-paste example in the wild shows the space-separated one-line form, so
 * the newline-only parser trained users straight into the footgun (I162).
 *
 * This parser is forgiving: it shell-tokenizes the whole value, treating BOTH
 * spaces and newlines as separators, while respecting single/double quotes and
 * backslash escapes so an argument that legitimately contains spaces can still
 * be expressed (`--msg "hello world"`). One-argument-per-line still parses
 * identically, so existing configurations keep working.
 *
 * Pure and total (never throws); unit-tested in `__tests__/args.test.ts`.
 */

/**
 * Tokenize the Arguments field value into an argv array.
 *
 * Separators: space, tab, CR, LF (any run collapses). Quoting:
 * - single quotes: literal, no escapes inside
 * - double quotes: literal, with `\"` and `\\` escapes honored
 * - backslash outside quotes escapes the next character (e.g. `\ ` → space)
 *
 * An unclosed quote consumes the remainder as one token (graceful, no throw).
 * Empty/whitespace-only input yields `[]`.
 */
export function parseAgentArgs(value: string): string[] {
	const args: string[] = [];
	let cur = "";
	let hasToken = false;
	let i = 0;
	const n = value.length;

	while (i < n) {
		const ch = value[i];

		if (ch === "'") {
			hasToken = true;
			i++;
			while (i < n && value[i] !== "'") {
				cur += value[i];
				i++;
			}
			i++; // consume closing quote (no-op if missing)
			continue;
		}

		if (ch === '"') {
			hasToken = true;
			i++;
			while (i < n && value[i] !== '"') {
				if (
					value[i] === "\\" &&
					i + 1 < n &&
					(value[i + 1] === '"' || value[i + 1] === "\\")
				) {
					cur += value[i + 1];
					i += 2;
				} else {
					cur += value[i];
					i++;
				}
			}
			i++; // consume closing quote (no-op if missing)
			continue;
		}

		if (ch === "\\" && i + 1 < n) {
			cur += value[i + 1];
			hasToken = true;
			i += 2;
			continue;
		}

		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			if (hasToken) {
				args.push(cur);
				cur = "";
				hasToken = false;
			}
			i++;
			continue;
		}

		cur += ch;
		hasToken = true;
		i++;
	}

	if (hasToken) {
		args.push(cur);
	}
	return args;
}

/**
 * Render an argv array back into the textarea value: one argument per line
 * (readable), with any argument that contains whitespace or quoting characters
 * wrapped in double quotes so that `parseAgentArgs(formatAgentArgs(args))`
 * round-trips to the same array. An empty-string argument renders as `""`.
 */
export function formatAgentArgs(args: string[]): string {
	return args.map(quoteArgIfNeeded).join("\n");
}

function quoteArgIfNeeded(arg: string): string {
	if (arg === "") {
		return '""';
	}
	if (/[\s"'\\]/.test(arg)) {
		return '"' + arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
	}
	return arg;
}

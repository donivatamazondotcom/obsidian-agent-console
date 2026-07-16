/**
 * Extract candidate ```a2ui fences from markdown text (probe check V01).
 *
 * Respects outer-fence nesting: fenced code does not nest in CommonMark —
 * everything inside an open fence is literal content until a valid closing
 * marker (same char, at least the opening run length, no info string). So an
 * a2ui fence quoted inside a 4-backtick or ```markdown block is never a
 * candidate here. An a2ui fence still open at the end of the text is
 * reported with `closed: false` so streaming partials stay inert
 * (spec § Fence robustness).
 *
 * Pure and total: any string in, candidates out, never throws.
 */
import type { A2uiFenceCandidate } from "./types";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const A2UI_LANGUAGE = "a2ui";

interface OpenFence {
	char: string;
	length: number;
	isA2ui: boolean;
	/** Char offset of the opening fence line's first character. */
	start: number;
	bodyLines: string[];
}

export function extractA2uiFences(markdown: string): A2uiFenceCandidate[] {
	const candidates: A2uiFenceCandidate[] = [];
	let open: OpenFence | null = null;
	let offset = 0;

	// Iterate lines while tracking char offsets (split would lose them).
	const lines = markdown.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineEnd = offset + line.length + (i < lines.length - 1 ? 1 : 0);

		if (open === null) {
			const m = FENCE_OPEN.exec(line);
			if (m) {
				const marker = m[1];
				const info = m[2].trim();
				// A backtick fence's info string cannot contain backticks.
				const infoOk = marker[0] !== "`" || !info.includes("`");
				if (infoOk) {
					const language = info.split(/\s+/)[0] ?? "";
					open = {
						char: marker[0],
						length: marker.length,
						isA2ui: language === A2UI_LANGUAGE,
						start: offset,
						bodyLines: [],
					};
				}
			}
		} else {
			const m = FENCE_OPEN.exec(line);
			const closes =
				m !== null &&
				m[1][0] === open.char &&
				m[1].length >= open.length &&
				m[2].trim() === "";
			if (closes) {
				if (open.isA2ui) {
					candidates.push({
						body: open.bodyLines.join("\n"),
						start: open.start,
						end: lineEnd,
						closed: true,
					});
				}
				open = null;
			} else {
				open.bodyLines.push(line);
			}
		}

		offset = lineEnd;
	}

	// Fence still open at end of text: streaming partial, stays inert.
	if (open !== null && open.isA2ui) {
		candidates.push({
			body: open.bodyLines.join("\n"),
			start: open.start,
			end: markdown.length,
			closed: false,
		});
	}

	return candidates;
}

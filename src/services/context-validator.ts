/**
 * Runtime data-model validator for context notes.
 *
 * The session-storage deserialize is a trust boundary: persisted bytes cross
 * from `unknown` back to typed `ContextNote[]`. Validate once there (and on any
 * in-memory replace), and fail loud — drop-and-log corrupt entries rather than
 * silently coercing them into valid-looking shapes.
 *
 * See: ACP Context Note Lifecycle spec § State Model; Tab Persistence retro
 * § "The missing piece: a runtime data-model validator".
 */
import type { ContextNote, ContextNoteSource } from "../types/context";
import { MAX_CONTEXT_NOTES } from "../types/context";

const SOURCES: readonly ContextNoteSource[] = [
	"user",
	"mention",
	"agent",
	"auto-default",
];

export interface Violation {
	code:
		| "over-cap"
		| "duplicate-path"
		| "empty-path"
		| "bad-source"
		| "bad-seen"
		| "not-an-object";
	index: number;
	detail: string;
}

/** Returns the list of invariant violations in `notes` (empty = valid). Pure. */
export function validateContextNotes(notes: readonly unknown[]): Violation[] {
	const violations: Violation[] = [];
	const seen = new Set<string>();

	notes.forEach((n, index) => {
		if (typeof n !== "object" || n === null) {
			violations.push({ code: "not-an-object", index, detail: String(n) });
			return;
		}
		const note = n as Partial<ContextNote>;
		if (typeof note.path !== "string" || note.path.length === 0) {
			violations.push({ code: "empty-path", index, detail: String(note.path) });
		} else if (seen.has(note.path)) {
			violations.push({ code: "duplicate-path", index, detail: note.path });
		} else {
			seen.add(note.path);
		}
		if (!SOURCES.includes(note.source as ContextNoteSource)) {
			violations.push({ code: "bad-source", index, detail: String(note.source) });
		}
		if (typeof note.seen !== "boolean") {
			violations.push({ code: "bad-seen", index, detail: String(note.seen) });
		}
	});

	if (notes.length > MAX_CONTEXT_NOTES) {
		violations.push({
			code: "over-cap",
			index: MAX_CONTEXT_NOTES,
			detail: `${notes.length} > ${MAX_CONTEXT_NOTES}`,
		});
	}

	return violations;
}

/**
 * Returns a cleaned array (well-formed, deduped by path, capped) plus the
 * violations that were dropped. Callers log `dropped`. Pure — no I/O.
 */
export function sanitizeContextNotes(notes: readonly unknown[]): {
	notes: ContextNote[];
	dropped: Violation[];
} {
	const clean: ContextNote[] = [];
	const dropped: Violation[] = [];
	const seen = new Set<string>();

	notes.forEach((n, index) => {
		if (typeof n !== "object" || n === null) {
			dropped.push({ code: "not-an-object", index, detail: String(n) });
			return;
		}
		const note = n as Partial<ContextNote>;
		if (typeof note.path !== "string" || note.path.length === 0) {
			dropped.push({ code: "empty-path", index, detail: String(note.path) });
			return;
		}
		if (seen.has(note.path)) {
			dropped.push({ code: "duplicate-path", index, detail: note.path });
			return;
		}
		if (!SOURCES.includes(note.source as ContextNoteSource)) {
			dropped.push({ code: "bad-source", index, detail: String(note.source) });
			return;
		}
		if (clean.length >= MAX_CONTEXT_NOTES) {
			dropped.push({ code: "over-cap", index, detail: note.path });
			return;
		}
		seen.add(note.path);
		clean.push({
			path: note.path,
			source: note.source as ContextNoteSource,
			seen: typeof note.seen === "boolean" ? note.seen : false,
		});
	});

	return { notes: clean, dropped };
}

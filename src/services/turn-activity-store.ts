/**
 * Chat Timestamps PR 3: a small per-panel store for the live turn's facts
 * (spec § Ticker and store). ChatPanel owns one, its per-second ticker is the
 * only publisher, and leaves (the status line, running tool-row times, and in
 * PR 4 the header time) read their own string through `useTurnActivitySlice`.
 *
 * No React here: the React context and selector hook live in
 * `ui/turn-activity-context.ts`, so hooks and services can name the store
 * without importing `ui/`.
 */
import type { TurnActivity } from "../types/chat-time";

export interface TurnActivitySnapshot {
	line: string | null;
	/** Tool call id → its running row's text. */
	rows: Readonly<Record<string, string>>;
	/** The chat's finished-turn agent time (PR 4); never cleared by `reset`. */
	total: number | null;
}

export interface TurnActivityStore {
	getSnapshot: () => TurnActivitySnapshot;
	subscribe: (listener: () => void) => () => void;
	/** Replace the live line and rows; notifies only when a string changed. */
	publish: (activity: TurnActivity) => void;
	publishTotal: (total: number | null) => void;
	/** Clear the live line and rows (turn end, tab switch); keeps the total. */
	reset: () => void;
}

const NO_ROWS: Readonly<Record<string, string>> = Object.freeze({});

function sameRows(
	a: Readonly<Record<string, string>>,
	b: Readonly<Record<string, string>>,
): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export function createTurnActivityStore(): TurnActivityStore {
	let snapshot: TurnActivitySnapshot = { line: null, rows: NO_ROWS, total: null };
	const listeners = new Set<() => void>();

	const commit = (next: TurnActivitySnapshot) => {
		snapshot = next;
		for (const listener of [...listeners]) listener();
	};

	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publish: ({ line, rows }) => {
			if (line === snapshot.line && sameRows(rows, snapshot.rows)) return;
			commit({ ...snapshot, line, rows: { ...rows } });
		},
		publishTotal: (total) => {
			if (total === snapshot.total) return;
			commit({ ...snapshot, total });
		},
		reset: () => {
			if (snapshot.line === null && Object.keys(snapshot.rows).length === 0) return;
			commit({ ...snapshot, line: null, rows: NO_ROWS });
		},
	};
}

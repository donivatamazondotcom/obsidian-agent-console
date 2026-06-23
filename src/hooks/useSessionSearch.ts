/**
 * useSessionSearch
 *
 * React state wrapper around the pure `session-search` engine. Owns:
 *  - the query string + a debounced copy (default 200ms)
 *  - a lazily-built content index (`idle → building → ready`)
 *  - single-entry invalidation (e.g. on session delete)
 *
 * The heavy lifting (extract / index / match / snippet) lives in
 * `services/session-search` and is pure + unit-tested. This hook only adds
 * React lifecycle: it is the `hooks/` layer, so it imports from services/types
 * but never from ui/.
 *
 * Two-tier behavior falls out of the engine: title matches are computed
 * synchronously against `sessions` (zero I/O) on every (debounced) query, while
 * content matches require the index. Title results therefore appear instantly
 * even while the content index is still building.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { ChatMessage } from "../types/chat";
import type { SessionInfo } from "../types/session";
import {
	buildIndexEntry,
	searchSessions,
	type SessionIndexEntry,
	type SearchMatch,
	type SessionSearchOptions,
} from "../services/session-search";

export type SearchIndexState = "idle" | "building" | "ready";

export interface UseSessionSearchOptions {
	/** Sessions to search (titles matched synchronously, in this order). */
	sessions: SessionInfo[];
	/** Loads a session's persisted messages for content indexing. */
	loadSessionMessages: (
		sessionId: string,
	) => Promise<ChatMessage[] | null>;
	/** Engine options (includeToolCalls / includeThoughts). */
	searchOptions?: SessionSearchOptions;
	/** Debounce window for the query in ms. Default 200. */
	debounceMs?: number;
}

export interface UseSessionSearchReturn {
	/** Current (immediate) query string. */
	query: string;
	/** Update the query (debounced internally before it affects results). */
	setQuery: (q: string) => void;
	/**
	 * Matches for the debounced query. Empty/whitespace query returns every
	 * session as a title match in input order (caller renders the full list).
	 */
	results: SearchMatch[];
	/** Content index build state. */
	indexState: SearchIndexState;
	/** Build the content index if idle (call on search-input focus). */
	ensureIndex: () => void;
	/** Drop a session's index entry (e.g. after delete). */
	invalidate: (sessionId: string) => void;
}

/**
 * Hook providing two-tier session search over the local session library.
 */
export function useSessionSearch({
	sessions,
	loadSessionMessages,
	searchOptions,
	debounceMs = 200,
}: UseSessionSearchOptions): UseSessionSearchReturn {
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [index, setIndex] = useState<Map<string, SessionIndexEntry>>(
		() => new Map(),
	);
	const [indexState, setIndexState] = useState<SearchIndexState>("idle");

	// Guard against concurrent builds. Latest sessions/loader/options are read
	// through refs so `ensureIndex` keeps a stable identity (its only real dep
	// is indexState).
	const buildingRef = useRef(false);
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;
	const loadRef = useRef(loadSessionMessages);
	loadRef.current = loadSessionMessages;
	const searchOptsRef = useRef(searchOptions);
	searchOptsRef.current = searchOptions;

	// Debounce query → debouncedQuery.
	useEffect(() => {
		const handle = window.setTimeout(
			() => setDebouncedQuery(query),
			debounceMs,
		);
		return () => window.clearTimeout(handle);
	}, [query, debounceMs]);

	const ensureIndex = useCallback(() => {
		if (buildingRef.current || indexState !== "idle") return;
		buildingRef.current = true;
		setIndexState("building");
		void (async () => {
			const next = new Map<string, SessionIndexEntry>();
			for (const s of sessionsRef.current) {
				try {
					const messages = await loadRef.current(s.sessionId);
					if (messages && messages.length > 0) {
						next.set(
							s.sessionId,
							buildIndexEntry(
								s.sessionId,
								messages,
								searchOptsRef.current,
							),
						);
					}
				} catch {
					// Unreadable session: skip it. Title search still works.
				}
			}
			setIndex(next);
			setIndexState("ready");
			buildingRef.current = false;
		})();
	}, [indexState]);

	const invalidate = useCallback((sessionId: string) => {
		setIndex((prev) => {
			if (!prev.has(sessionId)) return prev;
			const nextMap = new Map(prev);
			nextMap.delete(sessionId);
			return nextMap;
		});
	}, []);

	const results = useMemo(
		() => searchSessions(debouncedQuery, sessions, index),
		[debouncedQuery, sessions, index],
	);

	return useMemo(
		() => ({
			query,
			setQuery,
			results,
			indexState,
			ensureIndex,
			invalidate,
		}),
		[query, results, indexState, ensureIndex, invalidate],
	);
}

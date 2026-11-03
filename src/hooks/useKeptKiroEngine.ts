/**
 * The Kiro engine tab persistence keeps for this tab's session id (D2).
 *
 * Starts as the restored tab's value. A live, initialized session replaces
 * it with the engine it was launched with (I235), which is none for a
 * non-Kiro agent (I250). Kept while no session is live (a restored or
 * released tab), so the engine survives with the kept id. The decision is
 * the pure `resolveKeptKiroEngine`; this hook only holds it across renders.
 * Persisted only next to a saved session id (useTabPersistence).
 */
import { useRef } from "react";
import {
	resolveKeptKiroEngine,
	type SessionEngine,
} from "../resolvers/session-engine";

export function useKeptKiroEngine(
	restored: SessionEngine | undefined,
	session: {
		sessionId: string | null | undefined;
		kiroCli: boolean | undefined;
		kiroEngine: SessionEngine | undefined;
	},
): { readonly current: SessionEngine | undefined } {
	const ref = useRef<SessionEngine | undefined>(restored);
	ref.current = resolveKeptKiroEngine(ref.current, session);
	return ref;
}

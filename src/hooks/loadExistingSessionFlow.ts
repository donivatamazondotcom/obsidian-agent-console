import {
	NO_AGENT_CAPABILITIES,
	type AgentCapabilities,
	type SessionResult,
} from "../types/session";

export type SessionAcquisitionResult =
	| { ok: true; sessionId: string }
	| { ok: false; error: Error };

export interface LoadExistingSessionFlowArgs {
	sessionId: string;
	cwd: string;
	/**
	 * Whether local history is already displayed (seeded on mount). When
	 * true, the agent's `session/update` replay is suppressed so it does
	 * not duplicate the visible history; when false (type-before-restore
	 * race) the replay is allowed through as the sole source. (I43 #12)
	 */
	haveLocalHistory: boolean;
	loadSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
	onLoaded: (result: SessionResult) => void;
	setIgnoreUpdates: (ignore: boolean) => void;
}

/**
 * Resume an existing session on first-keystroke reconnect (I44), with
 * conditional replay suppression (I43 Decision #12). Pure orchestration —
 * all I/O is injected so it is unit-testable without rendering ChatPanel.
 *
 * Mirrors the canonical `useSessionHistory.restoreSession` ignore-updates
 * pattern: suppress before `loadSession`, release in `finally`.
 */
export async function loadExistingSessionFlow(
	args: LoadExistingSessionFlowArgs,
): Promise<SessionAcquisitionResult> {
	const { sessionId, cwd, haveLocalHistory, loadSession, onLoaded, setIgnoreUpdates } =
		args;
	if (haveLocalHistory) setIgnoreUpdates(true);
	try {
		const result = await loadSession(sessionId, cwd);
		onLoaded(result);
		return { ok: true, sessionId: result.sessionId };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err)),
		};
	} finally {
		if (haveLocalHistory) setIgnoreUpdates(false);
	}
}

/**
 * The slice of the ACP client a reconnect needs (I209). `AcpClient` satisfies
 * it structurally; tests fake it. `loadSession` / `resumeSession` throw while
 * the client is not initialized (`requireConnection()`).
 */
export interface ReconnectClientPort {
	isInitialized: () => boolean;
	getInitializeResult: () => { capabilities: AgentCapabilities } | null;
	loadSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
	resumeSession: (sessionId: string, cwd: string) => Promise<SessionResult>;
}

export interface ReconnectExistingSessionArgs {
	sessionId: string;
	cwd: string;
	client: ReconnectClientPort;
	/**
	 * Spawn and initialize the agent with the tab's config (the same builder
	 * eager initialize uses). Called only when the client is not initialized.
	 */
	initialize: () => Promise<void>;
	/**
	 * Whether a transcript is on screen right now. Read at load time, NOT from
	 * a mount snapshot: a tab that started fresh has no restored messages but
	 * has a transcript by the time it is released (I209).
	 */
	haveLocalHistory: () => boolean;
	onLoaded: (result: SessionResult) => void;
	setIgnoreUpdates: (ignore: boolean) => void;
	/** A resume attempt threw; the flow falls back to load. Logging only. */
	onResumeError?: (error: unknown) => void;
}

/**
 * Reconnect a kept session id — a released tab or a restored tab — when the
 * agent process may not be running (I209 § 3).
 *
 * 1. Initialize first when the client is disconnected. Loading on a
 *    disconnected client throws, which used to fall through to
 *    new-plus-transcript and show the lossy notice for a session the agent
 *    still had.
 * 2. With a transcript on screen and `session/resume` advertised, resume (no
 *    replay to suppress). A failed resume falls back to load.
 * 3. Otherwise load, suppressing the replay when a transcript is on screen
 *    (with none, the replay is the only source).
 *
 * Never throws. `{ ok: false }` tells the lazy owner to fall back to a new
 * session with the transcript as context. Capability is read from the
 * normalized record, never the agent id.
 */
export async function reconnectExistingSession(
	args: ReconnectExistingSessionArgs,
): Promise<SessionAcquisitionResult> {
	const { sessionId, cwd, client } = args;
	if (!client.isInitialized()) {
		try {
			await args.initialize();
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err : new Error(String(err)),
			};
		}
	}
	const capabilities =
		client.getInitializeResult()?.capabilities ?? NO_AGENT_CAPABILITIES;
	const haveLocalHistory = args.haveLocalHistory();

	if (haveLocalHistory && capabilities.restoresViaResume) {
		try {
			const result = await client.resumeSession(sessionId, cwd);
			args.onLoaded(result);
			return { ok: true, sessionId: result.sessionId };
		} catch (err) {
			args.onResumeError?.(err);
		}
	}

	return loadExistingSessionFlow({
		sessionId,
		cwd,
		haveLocalHistory,
		loadSession: (id, c) => client.loadSession(id, c),
		onLoaded: args.onLoaded,
		setIgnoreUpdates: args.setIgnoreUpdates,
	});
}

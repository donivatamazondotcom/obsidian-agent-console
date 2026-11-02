/**
 * Which title a session shows (I224 / I227).
 *
 * One decision for every surface that names a session: the Agent-view history
 * row (live and cached), the tab label when the session is restored or forked
 * into a tab, and the saved record. Precedence:
 *
 *   local title  >  agent title  >  none (the caller's fallback)
 *
 * - **local**: the plugin's saved title for that session id. It already holds
 *   a user rename or an AI title (a rename overwrites `title`; there is no
 *   separate rename flag), so it ranks first — Session History Source Model:
 *   "a server session the plugin also has should still show its local title".
 * - **agent**: the agent's own title from `session/list`, unless it is empty
 *   or a placeholder (the head of an injected block, see
 *   `isPlaceholderAgentTitle`).
 * - **none**: no usable title; each surface renders its own fallback text.
 *
 * The saved record adds one rung above all of this: a fresh AI suggestion
 * wins outright (`deriveSessionRecordTitle`).
 */
import { isFileMentionTitle } from "../utils/file-mention";
import { TITLE_RUBRIC } from "../utils/system-instructions";
import type { SavedSessionInfo, SessionInfo } from "../types/session";
import { suffixOnCollision, truncateLabel } from "../utils/tab-label";

export type ResolvedSessionTitle =
	| { kind: "local"; title: string }
	| { kind: "agent"; title: string }
	| { kind: "none" };

/**
 * True when an agent-reported session title is really the head of an injected
 * block (I223). Kiro V3 titles an untitled session with the first line of the
 * stored prompt, i.e. `<obsidian_system_instruction>`; Claude Code titles a
 * chat that opened with a context chip by the chip's `[@name](uri)` mention
 * (I242), and a chat with no chip by the opening of the plugin's own title
 * instruction, `TITLE_RUBRIC` (I243). None may be used as the session's title.
 */
export function isPlaceholderAgentTitle(title: string): boolean {
	return (
		/^<(?:obsidian_\w+|attached_file|carry_over_transcript)\b/.test(
			title.trim(),
		) ||
		isFileMentionTitle(title) ||
		isTitleRubricHead(title)
	);
}

/**
 * Shortest rubric head that counts as the rubric. Long enough that a real
 * title which happens to start the same way ("Begin your reply…") is kept.
 */
const MIN_RUBRIC_HEAD = 40;

/**
 * True when a title is the opening of `TITLE_RUBRIC` (I243): the whole rubric,
 * or a prefix of it cut off by the agent (with or without a trailing "…" or
 * "..."). Derived from the rubric itself, so editing the rubric can't silently
 * break the match.
 */
function isTitleRubricHead(title: string): boolean {
	const head = title.trim().replace(/(?:…|\.\.\.)$/, "").trimEnd();
	if (head.length < MIN_RUBRIC_HEAD) return false;
	return TITLE_RUBRIC.startsWith(head) || head.startsWith(TITLE_RUBRIC);
}

/** Resolve the title for one session. Total; never throws. */
export function resolveSessionTitle(input: {
	localTitle?: string | null;
	agentTitle?: string | null;
}): ResolvedSessionTitle {
	const local = input.localTitle?.trim();
	if (local) return { kind: "local", title: input.localTitle as string };
	const agent = input.agentTitle?.trim();
	if (agent && !isPlaceholderAgentTitle(agent)) {
		return { kind: "agent", title: input.agentTitle as string };
	}
	return { kind: "none" };
}

/** The resolved title, or undefined when there is none (callers render their fallback). */
export function resolvedTitleText(
	r: ResolvedSessionTitle,
): string | undefined {
	switch (r.kind) {
		case "local":
		case "agent":
			return r.title;
		case "none":
			return undefined;
	}
}

/**
 * Apply the title decision to Agent-view rows (live `session/list` or the
 * persisted metadata cache).
 *
 * The local record is found by **session id** (and agent), not by folder:
 * restore looks the record up by id, so a folder-scoped lookup here would let
 * the row and the restored tab disagree (I224).
 */
export function overlayLocalTitles(
	rows: SessionInfo[],
	saved: SavedSessionInfo[],
	agentId: string,
): SessionInfo[] {
	const byId = new Map(
		saved
			.filter((s) => s.agentId === agentId)
			.map((s) => [s.sessionId, s] as const),
	);
	return rows.map((row) => ({
		...row,
		title: resolvedTitleText(
			resolveSessionTitle({
				localTitle: byId.get(row.sessionId)?.title,
				agentTitle: row.title,
			}),
		),
	}));
}

/**
 * The label for a tab opened from a history row (restore or fork).
 *
 * `agentTitle` is the row's title as handed to the restore callback; it names
 * the tab when the plugin has no saved record (I227). `fallback` should be the
 * same text the row shows for an untitled session, so the two agree.
 */
export function deriveRestoreTabLabel(input: {
	mode: "restore" | "fork";
	savedTitle?: string | null;
	agentTitle?: string | null;
	/** Titles of every saved session — forks are suffixed against these. */
	savedTitles: string[];
	fallback: string;
	forkLabel: (base: string) => string;
}): string {
	const base =
		resolvedTitleText(
			resolveSessionTitle({
				localTitle: input.savedTitle,
				agentTitle: input.agentTitle,
			}),
		) ?? input.fallback;
	return input.mode === "fork"
		? suffixOnCollision(
				truncateLabel(input.forkLabel(base)),
				input.savedTitles,
			)
		: truncateLabel(base);
}

/**
 * Chat Timestamps PR 3: the facts behind the live status line and the tool
 * rows (spec § One activity rule for the line and the row, Decision 12).
 *
 * Everything returned is a measured fact: an elapsed time, an age, whether a
 * command printed or exited. Nothing claims a turn or a tool is stuck,
 * because a quiet agent or tool can be healthy and no threshold can make
 * that claim true (the Signals tenet, "Act on facts, not guesses").
 *
 * - `deriveTurnActivity`: the live line's text and each running row's text,
 *   computed by the per-second ticker over the live turn only.
 * - `deriveToolRowTime`: what any tool row shows for its own time, from its
 *   persisted fields and its turn's state.
 *
 * Pure: no React, no Obsidian; reads only its inputs.
 */
import { t } from "../i18n";
import { formatDuration, formatShortAge } from "../utils/time-format";
import type { ChatMessage, MessageContent, TurnEndKind } from "../types/chat";
import type {
	LiveTurnClock,
	TerminalTiming,
	TurnActivity,
} from "../types/chat-time";

/** One running tool call of the live turn, as the ticker sees it. */
export interface RunningCallInput {
	toolCallId: string;
	title: string | null;
	startedAt: number | null;
	/** The call's finished permission waits. */
	waitMs: number;
	requestedAt: number | null;
	answeredAt: number | null;
	/** Timing of a terminal the plugin runs for this call, if it knows one. */
	terminalTiming: TerminalTiming | null;
	/** The call's last output update (agent-run tools that stream output). */
	lastOutputAt: number | null;
}

export interface TurnActivityInput {
	now: number;
	clock: LiveTurnClock;
	/** The live turn's pending or in-progress calls, in order of appearance. */
	runningCalls: readonly RunningCallInput[];
}

function isTime(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/** A call's open time, leaving out its own finished and open permission waits. */
function callElapsed(call: RunningCallInput, now: number): number | null {
	if (!isTime(call.startedAt)) return null;
	const openWait =
		isTime(call.requestedAt) && !isTime(call.answeredAt)
			? Math.max(0, now - call.requestedAt)
			: 0;
	return Math.max(0, now - call.startedAt - Math.max(0, call.waitMs) - openWait);
}

/**
 * Whether the call itself can still say how it's doing. A command that has
 * exited says nothing more, so the line then adds the turn's last update.
 */
function hasLiveOutputSignal(call: RunningCallInput): boolean {
	if (call.terminalTiming !== null) return !isTime(call.terminalTiming.exitedAt);
	return isTime(call.lastOutputAt);
}

function rowText(call: RunningCallInput, now: number, elapsedMs: number): string {
	const elapsed = formatDuration(elapsedMs, "seconds");
	const term = call.terminalTiming;
	if (term) {
		if (isTime(term.exitedAt)) {
			return t("chat.toolCall.rowExited", { elapsed, age: formatShortAge(now - term.exitedAt) });
		}
		if (!isTime(term.lastOutputAt)) {
			return t("chat.toolCall.rowNoOutput", { elapsed });
		}
		return t("chat.toolCall.rowOutput", { elapsed, age: formatShortAge(now - term.lastOutputAt) });
	}
	if (isTime(call.lastOutputAt)) {
		return t("chat.toolCall.rowOutput", { elapsed, age: formatShortAge(now - call.lastOutputAt) });
	}
	return elapsed;
}

export function deriveTurnActivity(input: TurnActivityInput): TurnActivity {
	const { now, clock, runningCalls } = input;
	const rows: Record<string, string> = {};
	let named: { call: RunningCallInput; elapsedMs: number } | null = null;
	for (const call of runningCalls) {
		const elapsedMs = callElapsed(call, now);
		if (elapsedMs === null || !isTime(call.startedAt)) continue;
		rows[call.toolCallId] = rowText(call, now, elapsedMs);
		// The most recently started call names the line; a later one wins a tie.
		if (named === null || (named.call.startedAt as number) <= call.startedAt) {
			named = { call, elapsedMs };
		}
	}

	const updateAge = formatShortAge(now - clock.lastUpdateAt);
	let line: string;
	let lineTitle: string | null = null;
	if (named !== null) {
		const title = named.call.title?.trim() || t("chat.toolCall.title");
		const elapsed = formatDuration(named.elapsedMs, "minutes");
		lineTitle = t("chat.activity.runningTitle", { title });
		line =
			!hasLiveOutputSignal(named.call) && clock.hasUpdate
				? t("chat.activity.runningFactsWithUpdate", { elapsed, age: updateAge })
				: t("chat.activity.runningFacts", { elapsed });
	} else {
		const openWait = isTime(clock.waitStartedAt) ? Math.max(0, now - clock.waitStartedAt) : 0;
		const elapsedMs = Math.max(0, now - clock.sentAt - Math.max(0, clock.turnWaitMs) - openWait);
		const elapsed = formatDuration(elapsedMs, "minutes");
		line = clock.hasUpdate
			? t("chat.activity.working", { elapsed, age: updateAge })
			: t("chat.activity.workingNoUpdate", { elapsed });
	}
	return { line, lineTitle, rows };
}

type ToolItem = Extract<MessageContent, { type: "tool_call" }>;

function isOpen(item: ToolItem): boolean {
	return (
		item.status !== "completed" &&
		item.status !== "failed" &&
		!item.interrupted &&
		!isTime(item.endedAt)
	);
}

/**
 * The ticker's read of the transcript: the live turn's open calls (after
 * its prompt), with each one's terminal timing and last output update,
 * then `deriveTurnActivity`. Null with no live turn or when its prompt is
 * gone (a clear or restore raced the tick). `getTerminalTiming` returns
 * null for an id the plugin never spawned (Codex's own terminal ids).
 */
export function deriveLiveTurnActivity(
	messages: readonly ChatMessage[],
	clock: LiveTurnClock | null,
	getTerminalTiming: (terminalId: string) => TerminalTiming | null,
	now: number,
): TurnActivity | null {
	if (clock === null) return null;
	let start = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].id === clock.promptId) {
			start = i;
			break;
		}
	}
	if (start < 0) return null;
	const runningCalls: RunningCallInput[] = [];
	for (let i = start + 1; i < messages.length; i++) {
		for (const c of messages[i].content) {
			if (c.type !== "tool_call" || !isOpen(c)) continue;
			const terminal = c.content?.find((x) => x.type === "terminal");
			runningCalls.push({
				toolCallId: c.toolCallId,
				title: c.title ?? null,
				startedAt: isTime(c.startedAt) ? c.startedAt : null,
				waitMs: isTime(c.waitMs) ? c.waitMs : 0,
				requestedAt: isTime(c.requestedAt) ? c.requestedAt : null,
				answeredAt: isTime(c.answeredAt) ? c.answeredAt : null,
				terminalTiming:
					terminal && terminal.type === "terminal"
						? getTerminalTiming(terminal.terminalId)
						: null,
				lastOutputAt: clock.lastOutputAtByCall.get(c.toolCallId) ?? null,
			});
		}
	}
	return deriveTurnActivity({ now, clock, runningCalls });
}

/**
 * Where a row stands for its time: `"live"` while its turn runs, its prompt's
 * `turnEndKind` once that turn ended, or unknown (a restart mid-turn, a chat
 * saved before this feature).
 */
export type ToolRunState = "live" | TurnEndKind | undefined;

export type ToolRowTime =
	| { kind: "none" }
	| { kind: "running"; startedAt: number }
	| { kind: "finished"; durationMs: number; startedAt: number; endedAt: number }
	| { kind: "interrupted"; label: "stopped" | "openAtTurnEnd"; durationMs: number | null };

/**
 * A tool row's own time (Decision 12). A row its turn closed reads `Stopped`
 * when you stopped the turn and `Open at turn end` otherwise; both describe
 * the turn end, so a status the agent sends later can't make them wrong. The
 * label comes from the turn's end kind, never from `interrupted` alone.
 */
export function deriveToolRowTime(item: ToolItem, state: ToolRunState): ToolRowTime {
	const { startedAt, endedAt } = item;
	const waitMs = isTime(item.waitMs) ? Math.max(0, item.waitMs) : 0;
	const runMs =
		isTime(startedAt) && isTime(endedAt) ? Math.max(0, endedAt - startedAt - waitMs) : null;
	if (item.interrupted) {
		if (state === undefined || state === "live") return { kind: "none" };
		return {
			kind: "interrupted",
			label: state === "stopped" ? "stopped" : "openAtTurnEnd",
			durationMs: runMs,
		};
	}
	if (item.status === "completed" || item.status === "failed") {
		if (runMs === null || !isTime(startedAt) || !isTime(endedAt)) return { kind: "none" };
		return { kind: "finished", durationMs: runMs, startedAt, endedAt };
	}
	if (state === "live" && isTime(startedAt)) return { kind: "running", startedAt };
	return { kind: "none" };
}

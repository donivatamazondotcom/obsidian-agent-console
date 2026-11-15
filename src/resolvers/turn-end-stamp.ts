/**
 * `deriveTurnEndStamp` — what a prompt's turn-end stamp says.
 *
 * A turn that ended shows when it ended: `9:18 AM · 6m` when it finished,
 * `Stopped 9:49 AM · 18m` when it was stopped, `Failed 9:49 AM` when it failed
 * (Decision 2). A turn that is still running, or whose end is unknown (history
 * replayed from the agent, a chat saved before this feature, a restart in the
 * middle of a turn), shows nothing (Decision 8). The duration is the prompt's
 * `turnMs`, which already leaves out time spent waiting on you; when it is
 * unknown the stamp shows the time alone.
 *
 * Pure: reads only the prompt's persisted fields.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Prompt and turn-end stamps.
 */
import type { ChatMessage } from "../types/chat";

export type TurnEndStamp =
	| { kind: "none" }
	| { kind: "done" | "stopped"; at: number; durationMs: number | null }
	| { kind: "failed"; at: number };

function isTime(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

export function deriveTurnEndStamp(prompt: ChatMessage): TurnEndStamp {
	if (prompt.role !== "user") return { kind: "none" };
	const at = prompt.turnEndedAt;
	const kind = prompt.turnEndKind;
	if (!isTime(at) || kind === undefined) return { kind: "none" };
	switch (kind) {
		case "failed":
			return { kind: "failed", at };
		case "done":
		case "stopped":
			return {
				kind,
				at,
				durationMs: isTime(prompt.turnMs) ? Math.max(0, prompt.turnMs) : null,
			};
	}
}

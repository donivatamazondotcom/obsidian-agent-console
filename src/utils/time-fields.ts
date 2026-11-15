/**
 * Chat Timestamps — shared time-field rules.
 *
 * All new time fields are epoch milliseconds, `number | null`, where null
 * means unknown ("no stamp beats a wrong stamp", Decision 8). This module
 * holds the gap threshold and the load-edge validator, which turns any value
 * the session file can't be trusted on into null.
 *
 * Spec: [[Agent Console Chat Timestamps]] § Time fields.
 */
import type { ChatMessage, MessageContent, TurnEndKind } from "../types/chat";

/**
 * An item that arrives more than this long after the turn's last live
 * update gets a gap stamp. Starting point; calibrated by probe P2.
 */
export const GAP_STAMP_THRESHOLD_MS = 60_000;

const TURN_END_KINDS: ReadonlySet<string> = new Set<TurnEndKind>([
	"done",
	"failed",
	"stopped",
]);

const MESSAGE_TIME_KEYS = [
	"sentAt",
	"turnEndedAt",
	"turnWaitMs",
	"turnMs",
] as const;

const TOOL_TIME_KEYS = [
	"startedAt",
	"endedAt",
	"requestedAt",
	"answeredAt",
	"waitMs",
] as const;

/** Result of validating one message: the message and how many fields were dropped. */
export interface ValidatedMessage {
	message: ChatMessage;
	dropped: number;
}

/**
 * Validate the time fields of one loaded message. A time that isn't a finite
 * number becomes null; a turn-end kind or boolean flag of the wrong shape is
 * removed. Fields that are absent stay absent. Every other field is left as
 * loaded. Pure; the caller logs `dropped`.
 */
export function validateMessageTimeFields(message: ChatMessage): ValidatedMessage {
	let dropped = 0;
	const out: Record<string, unknown> = { ...message };
	for (const key of MESSAGE_TIME_KEYS) {
		if (key in out && !isTime(out[key])) {
			if (out[key] !== null) dropped++;
			out[key] = null;
		}
	}
	if ("turnEndKind" in out && !TURN_END_KINDS.has(out.turnEndKind as string)) {
		dropped++;
		delete out.turnEndKind;
	}
	if (Array.isArray(message.content)) {
		out.content = message.content.map((item) => {
			const r = validateItem(item);
			dropped += r.dropped;
			return r.item;
		});
	}
	return { message: out as unknown as ChatMessage, dropped };
}

function validateItem(item: MessageContent): { item: MessageContent; dropped: number } {
	if (item === null || typeof item !== "object") return { item, dropped: 0 };
	let dropped = 0;
	const out: Record<string, unknown> = { ...item };
	const keys: readonly string[] =
		item.type === "tool_call" ? ["arrivedAt", ...TOOL_TIME_KEYS] : ["arrivedAt"];
	for (const key of keys) {
		if (key in out && !isTime(out[key])) {
			if (out[key] !== null) dropped++;
			out[key] = null;
		}
	}
	for (const flag of ["gapBefore", "interrupted"]) {
		if (flag in out && typeof out[flag] !== "boolean") {
			dropped++;
			delete out[flag];
		}
	}
	return { item: out as unknown as MessageContent, dropped };
}

function isTime(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

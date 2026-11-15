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

/**
 * Every saved time field and whether it holds a moment (epoch ms) or a
 * duration (ms). Typed by key, so a new field can't be validated without
 * being classified.
 */
type TimeKey =
	| "sentAt"
	| "turnEndedAt"
	| "turnWaitMs"
	| "turnMs"
	| "arrivedAt"
	| "startedAt"
	| "endedAt"
	| "requestedAt"
	| "answeredAt"
	| "waitMs";

const TIME_KIND: Readonly<Record<TimeKey, "moment" | "duration">> = {
	sentAt: "moment",
	turnEndedAt: "moment",
	arrivedAt: "moment",
	startedAt: "moment",
	endedAt: "moment",
	requestedAt: "moment",
	answeredAt: "moment",
	turnWaitMs: "duration",
	turnMs: "duration",
	waitMs: "duration",
};

const MESSAGE_TIME_KEYS: readonly TimeKey[] = ["sentAt", "turnEndedAt", "turnWaitMs", "turnMs"];

const TOOL_TIME_KEYS: readonly TimeKey[] = [
	"startedAt",
	"endedAt",
	"requestedAt",
	"answeredAt",
	"waitMs",
];

/** The largest magnitude a JS Date can hold; beyond it, formatting throws. */
const MAX_DATE_MS = 8.64e15;

/**
 * No real stamp predates this: Agent Console didn't exist yet. An earlier
 * moment (0, a small corrupt value) is unknown, not "Jan 1, 1970" (Decision 8).
 */
const EARLIEST_INSTANT_MS = Date.UTC(2020, 0, 1);

/** Result of validating one message: the message and how many fields were dropped. */
export interface ValidatedMessage {
	message: ChatMessage;
	dropped: number;
}

/**
 * Validate the time fields of one loaded message. A time that isn't a finite
 * number inside the Date range, or a moment before 2020, becomes null; a turn-end kind or boolean flag of the wrong shape is
 * removed. Fields that are absent stay absent. Every other field is left as
 * loaded. Pure; the caller logs `dropped`.
 */
export function validateMessageTimeFields(message: ChatMessage): ValidatedMessage {
	let dropped = 0;
	const out: Record<string, unknown> = { ...message };
	for (const key of MESSAGE_TIME_KEYS) {
		if (key in out && !isValidTime(key, out[key])) {
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
	const keys: readonly TimeKey[] =
		item.type === "tool_call" ? ["arrivedAt", ...TOOL_TIME_KEYS] : ["arrivedAt"];
	for (const key of keys) {
		if (key in out && !isValidTime(key, out[key])) {
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

/**
 * A moment must be a finite epoch-ms value inside the Date range and not
 * before 2020; a duration must be finite and inside the Date range. A value a
 * formatter would throw on never reaches a render.
 */
function isValidTime(key: TimeKey, v: unknown): v is number {
	if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > MAX_DATE_MS) {
		return false;
	}
	return TIME_KIND[key] === "moment" ? v >= EARLIEST_INSTANT_MS : true;
}

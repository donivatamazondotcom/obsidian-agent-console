/**
 * Chat Timestamps PR 3: the pure decisions behind the live line and the tool
 * rows (spec § One activity rule, § Live status line, Decision 12).
 *
 * - `deriveTurnActivity`: the live line's text and each running row's text,
 *   as measured facts only (the Signals tenet: no "stuck", no warning).
 * - `deriveToolRowTime`: what a row that isn't running shows (its duration,
 *   or `Stopped` / `Open at turn end` when its turn closed it).
 */
import { describe, expect, it } from "vitest";
import {
	deriveLiveTurnActivity,
	deriveToolRowTime,
	deriveTurnActivity,
	type RunningCallInput,
} from "../turn-activity";
import type { LiveTurnClock } from "../../types/chat-time";
import type { MessageContent } from "../../types/chat";

const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

function clock(over: Partial<LiveTurnClock> = {}): LiveTurnClock {
	return {
		promptId: "p1",
		sentAt: T0,
		lastUpdateAt: T0,
		hasUpdate: false,
		waitStartedAt: null,
		turnWaitMs: 0,
		lastOutputAtByCall: new Map(),
		...over,
	};
}

function call(over: Partial<RunningCallInput> = {}): RunningCallInput {
	return {
		toolCallId: "tc1",
		title: "npm test",
		startedAt: T0 + 10 * SEC,
		waitMs: 0,
		requestedAt: null,
		answeredAt: null,
		terminalTiming: null,
		lastOutputAt: null,
		...over,
	};
}

const run = (now: number, c: LiveTurnClock, calls: RunningCallInput[] = []) =>
	deriveTurnActivity({ now, clock: c, runningCalls: calls });

describe("deriveTurnActivity: the line with no tool running", () => {
	it("before any update: elapsed and 'no update yet'", () => {
		expect(run(T0 + 2 * MIN, clock()).line).toBe("Working 2m · no update yet");
	});

	it("after an update: elapsed and its age", () => {
		const c = clock({ hasUpdate: true, lastUpdateAt: T0 + 3 * MIN + 50 * SEC });
		expect(run(T0 + 4 * MIN, c).line).toBe("Working 4m · last update 10s ago");
	});

	it("a quiet turn shows the plain fact, with no other wording", () => {
		const c = clock({ hasUpdate: true, lastUpdateAt: T0 + 4 * MIN });
		expect(run(T0 + 9 * MIN, c).line).toBe("Working 9m · last update 5m ago");
	});

	it("leaves out finished and open permission waits", () => {
		const c = clock({ hasUpdate: true, lastUpdateAt: T0 + 3 * MIN, turnWaitMs: MIN, waitStartedAt: T0 + 3 * MIN });
		expect(run(T0 + 4 * MIN, c).line).toBe("Working 2m · last update 1m ago");
	});

	it("never shows a negative age (clock skew)", () => {
		const c = clock({ hasUpdate: true, lastUpdateAt: T0 + 5 * SEC });
		expect(run(T0 + 3 * SEC, c).line).toBe("Working 3s · last update just now");
	});
});

describe("deriveTurnActivity: running rows", () => {
	it("a command the plugin runs, before its first output", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [
			call({ terminalTiming: { lastOutputAt: null, exitedAt: null, releasedAt: null } }),
		]);
		expect(a.rows).toEqual({ tc1: "1m · no output yet" });
		expect(a.line).toBe("Running npm test · 1m");
	});

	it("a command the plugin runs, after it printed", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [
			call({ terminalTiming: { lastOutputAt: T0 + 68 * SEC, exitedAt: null, releasedAt: null } }),
		]);
		expect(a.rows.tc1).toBe("1m · output 2s ago");
	});

	it("a command that exited while the call stays open", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [
			call({ terminalTiming: { lastOutputAt: T0 + 40 * SEC, exitedAt: T0 + 50 * SEC, releasedAt: T0 + 51 * SEC } }),
		]);
		expect(a.rows.tc1).toBe("1m · exited 20s ago");
	});

	it("an agent-run tool that streams its output", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [call({ lastOutputAt: T0 + 65 * SEC })]);
		expect(a.rows.tc1).toBe("1m · output 5s ago");
		expect(a.line).toBe("Running npm test · 1m");
	});

	it("an agent-run tool with no output signal: elapsed only, and the line adds the turn's last update", () => {
		const c = clock({ hasUpdate: true, lastUpdateAt: T0 + 40 * SEC });
		const a = run(T0 + 70 * SEC, c, [call({ title: "Bash" })]);
		expect(a.rows.tc1).toBe("1m");
		expect(a.line).toBe("Running Bash · 1m · last update 30s ago");
	});

	it("an agent-run tool runs for an hour with no output: still the plain elapsed time", () => {
		const a = run(T0 + 70 * MIN, clock({ hasUpdate: true }), [call({ startedAt: T0 })]);
		expect(a.rows.tc1).toBe("1h 10m");
	});

	it("names the most recently started call on the line", () => {
		const a = run(T0 + 90 * SEC, clock({ hasUpdate: true }), [
			call({ toolCallId: "a", title: "first", startedAt: T0 + 20 * SEC }),
			call({ toolCallId: "b", title: "second", startedAt: T0 + 30 * SEC }),
			call({ toolCallId: "c", title: "older", startedAt: T0 + 10 * SEC }),
		]);
		expect(a.line?.startsWith("Running second ·")).toBe(true);
	});

	it("a row leaves out its own finished and open permission waits", () => {
		const a = run(T0 + 90 * SEC, clock({ hasUpdate: true }), [
			call({ startedAt: T0 + 10 * SEC, waitMs: 20 * SEC, requestedAt: T0 + 60 * SEC, answeredAt: null }),
		]);
		expect(a.rows.tc1).toBe("30s");
	});

	it("a sibling's output never changes another row's text", () => {
		const quiet = call({ toolCallId: "quiet", title: "sleep", terminalTiming: { lastOutputAt: null, exitedAt: null, releasedAt: null } });
		const loud = call({ toolCallId: "loud", lastOutputAt: T0 + 69 * SEC });
		const before = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [quiet]).rows.quiet;
		const after = run(T0 + 70 * SEC, clock({ hasUpdate: true, lastUpdateAt: T0 + 69 * SEC }), [quiet, loud]).rows.quiet;
		expect(after).toBe(before);
	});

	it("a call with no known start gets no row text, and the line falls back to Working", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true, lastUpdateAt: T0 + 60 * SEC }), [call({ startedAt: null })]);
		expect(a.rows).toEqual({});
		expect(a.line).toBe("Working 1m · last update 10s ago");
	});

	it("a call with no title is named by its kind of item", () => {
		const a = run(T0 + 70 * SEC, clock({ hasUpdate: true }), [call({ title: null, lastOutputAt: T0 + 69 * SEC })]);
		expect(a.line).toBe("Running Tool call · 1m");
	});
});

type ToolItem = Extract<MessageContent, { type: "tool_call" }>;
const item = (over: Partial<ToolItem>): ToolItem => ({
	type: "tool_call",
	toolCallId: "tc1",
	title: "npm test",
	status: "completed",
	startedAt: T0,
	endedAt: T0 + 112 * SEC,
	waitMs: 0,
	...over,
});

describe("deriveToolRowTime", () => {
	it("a finished row shows its run time", () => {
		expect(deriveToolRowTime(item({}), undefined)).toEqual({
			kind: "finished",
			durationMs: 112 * SEC,
			startedAt: T0,
			endedAt: T0 + 112 * SEC,
		});
	});

	it("leaves the row's permission wait out of the run time", () => {
		expect(deriveToolRowTime(item({ waitMs: 12 * SEC }), "done")).toMatchObject({ kind: "finished", durationMs: 100 * SEC });
	});

	it("a failed row shows its run time too", () => {
		expect(deriveToolRowTime(item({ status: "failed" }), "done").kind).toBe("finished");
	});

	it("an unknown time shows nothing (no stamp beats a wrong stamp)", () => {
		expect(deriveToolRowTime(item({ startedAt: null }), "done")).toEqual({ kind: "none" });
	});

	it.each([
		["stopped", "stopped"],
		["done", "openAtTurnEnd"],
		["failed", "openAtTurnEnd"],
	] as const)("an interrupted row under a %s turn reads %s", (endKind, label) => {
		expect(deriveToolRowTime(item({ status: "in_progress", interrupted: true }), endKind)).toEqual({
			kind: "interrupted",
			label,
			durationMs: 112 * SEC,
		});
	});

	it("a late completed after the closer doesn't change the interrupted label", () => {
		expect(deriveToolRowTime(item({ status: "completed", interrupted: true }), "done")).toMatchObject({
			kind: "interrupted",
			label: "openAtTurnEnd",
		});
	});

	it("an interrupted row with no known turn end shows nothing", () => {
		expect(deriveToolRowTime(item({ status: "in_progress", interrupted: true }), undefined)).toEqual({ kind: "none" });
	});

	it("an interrupted row with an unknown start keeps its label with no time", () => {
		expect(deriveToolRowTime(item({ interrupted: true, startedAt: null }), "stopped")).toEqual({
			kind: "interrupted",
			label: "stopped",
			durationMs: null,
		});
	});

	it("a running row in the live turn is running; outside it, nothing", () => {
		const running = item({ status: "in_progress", endedAt: null });
		expect(deriveToolRowTime(running, "live")).toEqual({ kind: "running", startedAt: T0 });
		expect(deriveToolRowTime(running, undefined)).toEqual({ kind: "none" });
		expect(deriveToolRowTime({ ...running, status: "pending" }, "live").kind).toBe("running");
	});
});

describe("deriveLiveTurnActivity: the ticker's read of the transcript", () => {
	const msg = (role: "user" | "assistant", id: string, content: MessageContent[]) =>
		({ id, role, content, timestamp: new Date(T0) }) as import("../../types/chat").ChatMessage;

	it("is null with no live turn, or when its prompt is gone", () => {
		expect(deriveLiveTurnActivity([], null, () => null, T0)).toBeNull();
		expect(deriveLiveTurnActivity([msg("user", "other", [])], clock(), () => null, T0)).toBeNull();
	});

	it("reads only the live turn's open calls, with their terminal and output times", () => {
		const messages = [
			msg("user", "p0", []),
			msg("assistant", "old", [item({ toolCallId: "old", status: "in_progress", endedAt: null })]),
			msg("user", "p1", []),
			msg("assistant", "a1", [item({ toolCallId: "done", status: "completed" })]),
			msg("assistant", "a2", [
				item({
					toolCallId: "cmd",
					status: "in_progress",
					startedAt: T0 + 10 * SEC,
					endedAt: null,
					content: [{ type: "terminal", terminalId: "term-1" }],
				}),
			]),
			msg("assistant", "a3", [item({ toolCallId: "codex", status: "pending", startedAt: T0 + 20 * SEC, endedAt: null, content: [{ type: "terminal", terminalId: "codex-own" }] })]),
			msg("assistant", "a4", [item({ toolCallId: "closed", status: "in_progress", interrupted: true, endedAt: T0 })]),
		];
		const c = clock({ promptId: "p1", hasUpdate: true, lastOutputAtByCall: new Map([["codex", T0 + 25 * SEC]]) });
		const lookup = (id: string) => (id === "term-1" ? { lastOutputAt: T0 + 28 * SEC, exitedAt: null, releasedAt: null } : null);
		const a = deriveLiveTurnActivity(messages, c, lookup, T0 + 30 * SEC);
		expect(a?.rows).toEqual({ cmd: "20s · output 2s ago", codex: "10s · output 5s ago" });
		expect(a?.line).toBe("Running npm test · 10s");
	});
});

/**
 * Tests for `voiceCaptureReducer` — the one owner of this vault's recording
 * slot and its transcription jobs.
 *
 * Scenario tests assert the emitted effects (what the adapter must do) and the
 * selector outputs (what the UI shows). The property test asserts the
 * no-silent-data-loss invariant: every recording that captured audio is
 * either still a live job (retryable / undoable) or has been explicitly
 * delivered or discarded.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
	voiceCaptureReducer,
	initialVoiceCapture,
	captureStateFor,
	recordingOrigin,
	type VoiceCaptureModel,
	type VoiceCaptureEvent,
	type VoiceCaptureEffect,
} from "../voice-capture-reducer";

const A = { leafId: "leaf-a", tabId: "tab-1" };
const B = { leafId: "leaf-a", tabId: "tab-2" };

/** Fold events, collecting every effect in order. */
function run(
	events: VoiceCaptureEvent[],
	start: VoiceCaptureModel = initialVoiceCapture,
): { model: VoiceCaptureModel; effects: VoiceCaptureEffect[] } {
	let model = start;
	const effects: VoiceCaptureEffect[] = [];
	for (const e of events) {
		const out = voiceCaptureReducer(model, e);
		model = out.state;
		effects.push(...out.effects);
	}
	return { model, effects };
}

const listeningIn = (tab = A): VoiceCaptureEvent[] => [
	{ type: "start", origin: tab, mode: "insert" },
	{ type: "micOpened", now: 1000 },
];

describe("start and listen", () => {
	it("start takes the lease and opens the mic", () => {
		const { model, effects } = run([
			{ type: "start", origin: A, mode: "insert" },
		]);
		expect(effects).toEqual([{ kind: "acquireLease" }, { kind: "openMic" }]);
		expect(captureStateFor(model, A)).toBe("listening");
		expect(recordingOrigin(model)).toEqual(A);
	});

	it("mic opened records the start time", () => {
		const { model } = run(listeningIn());
		expect(model.recording).toEqual({
			status: "listening",
			origin: A,
			mode: "insert",
			startedAt: 1000,
		});
	});

	it("start again in the same tab does nothing", () => {
		const { effects } = run([
			...listeningIn(),
			{ type: "start", origin: A, mode: "insert" },
		]);
		expect(effects).toEqual([{ kind: "acquireLease" }, { kind: "openMic" }]);
	});

	it("mic failure releases the lease and shows an error in the origin tab only", () => {
		const { model, effects } = run([
			{ type: "start", origin: A, mode: "insert" },
			{ type: "micFailed", message: "denied" },
		]);
		expect(effects.slice(2)).toEqual([{ kind: "releaseLease" }]);
		expect(model.recording).toBeNull();
		expect(captureStateFor(model, A)).toBe("error");
		expect(captureStateFor(model, B)).toBe("idle");
	});

	it("starting again clears an old mic error", () => {
		const { model } = run([
			{ type: "start", origin: A, mode: "insert" },
			{ type: "micFailed", message: "denied" },
			{ type: "start", origin: A, mode: "insert" },
		]);
		expect(model.micError).toBeNull();
	});
});

describe("stop → transcribe → deliver", () => {
	it("T01: stop keeps the audio as a job, then delivers text to the origin tab", () => {
		const { model, effects } = run([
			...listeningIn(),
			{ type: "stop" },
			{ type: "transcribed", jobId: 1, text: "the last meeting" },
		]);
		expect(effects.slice(2)).toEqual([
			{ kind: "stopMic", jobId: 1, then: "transcribe" },
			{ kind: "releaseLease" },
			{ kind: "deliver", origin: A, text: "the last meeting", mode: "insert" },
			{ kind: "discardAudio", jobId: 1 },
		]);
		expect(model.jobs).toEqual([]);
		expect(captureStateFor(model, A)).toBe("idle");
	});

	it("shows transcribing in the origin tab while the engine works", () => {
		const { model } = run([...listeningIn(), { type: "stop" }]);
		expect(captureStateFor(model, A)).toBe("transcribing");
		expect(recordingOrigin(model)).toBeNull();
	});

	it("T02: stop with send mode delivers as a send", () => {
		const { effects } = run([
			...listeningIn(),
			{ type: "stop", mode: "send" },
			{ type: "transcribed", jobId: 1, text: "go" },
		]);
		expect(effects).toContainEqual({
			kind: "deliver",
			origin: A,
			text: "go",
			mode: "send",
		});
	});

	it("stop before the mic opens just closes it — no job, no audio", () => {
		const { model, effects } = run([
			{ type: "start", origin: A, mode: "insert" },
			{ type: "stop" },
		]);
		expect(effects.slice(2)).toEqual([
			{ kind: "closeMic" },
			{ kind: "releaseLease" },
		]);
		expect(model.jobs).toEqual([]);
	});

	it("stop with nothing recording does nothing", () => {
		expect(run([{ type: "stop" }]).effects).toEqual([]);
	});

	it("a failed transcription keeps the audio for retry", () => {
		const { model, effects } = run([
			...listeningIn(),
			{ type: "stop" },
			{ type: "transcribeFailed", jobId: 1, message: "engine crashed" },
		]);
		expect(effects).not.toContainEqual({ kind: "discardAudio", jobId: 1 });
		expect(model.jobs).toEqual([
			{
				id: 1,
				origin: A,
				mode: "insert",
				status: "failed",
				error: "engine crashed",
			},
		]);
		expect(captureStateFor(model, A)).toBe("error");
	});

	it("retry re-runs the engine on the kept audio", () => {
		const { model, effects } = run([
			...listeningIn(),
			{ type: "stop" },
			{ type: "transcribeFailed", jobId: 1, message: "x" },
			{ type: "retry", jobId: 1 },
			{ type: "transcribed", jobId: 1, text: "ok" },
		]);
		expect(effects).toContainEqual({ kind: "transcribe", jobId: 1 });
		expect(effects.at(-2)).toEqual({
			kind: "deliver",
			origin: A,
			text: "ok",
			mode: "insert",
		});
		expect(model.jobs).toEqual([]);
	});

	it("dismissing a failed job is the explicit way to drop its audio", () => {
		const { model, effects } = run([
			...listeningIn(),
			{ type: "stop" },
			{ type: "transcribeFailed", jobId: 1, message: "x" },
			{ type: "dismiss", jobId: 1 },
		]);
		expect(effects.at(-1)).toEqual({ kind: "discardAudio", jobId: 1 });
		expect(model.jobs).toEqual([]);
	});
});

describe("cancel with undo (T03)", () => {
	it("Esc holds the audio and starts the undo window", () => {
		const { model, effects } = run([...listeningIn(), { type: "cancel" }]);
		expect(effects.slice(2)).toEqual([
			{ kind: "stopMic", jobId: 1, then: "hold" },
			{ kind: "scheduleUndoExpiry", jobId: 1 },
			{ kind: "releaseLease" },
		]);
		expect(model.jobs[0].status).toBe("cancelled");
		expect(captureStateFor(model, A)).toBe("idle");
	});

	it("undo transcribes and inserts", () => {
		const { effects } = run([
			...listeningIn(),
			{ type: "cancel" },
			{ type: "undo", jobId: 1 },
			{ type: "transcribed", jobId: 1, text: "kept" },
		]);
		expect(effects).toContainEqual({ kind: "transcribe", jobId: 1 });
		expect(effects).toContainEqual({
			kind: "deliver",
			origin: A,
			text: "kept",
			mode: "insert",
		});
	});

	it("without undo, the window expiring drops the audio and inserts nothing", () => {
		const { model, effects } = run([
			...listeningIn(),
			{ type: "cancel" },
			{ type: "undoExpired", jobId: 1 },
		]);
		expect(effects.at(-1)).toEqual({ kind: "discardAudio", jobId: 1 });
		expect(effects.some((e) => e.kind === "deliver")).toBe(false);
		expect(model.jobs).toEqual([]);
	});

	it("undo after expiry does nothing", () => {
		const { effects } = run([
			...listeningIn(),
			{ type: "cancel" },
			{ type: "undoExpired", jobId: 1 },
			{ type: "undo", jobId: 1 },
		]);
		expect(effects.filter((e) => e.kind === "transcribe")).toEqual([]);
	});
});

describe("hand-off", () => {
	it("start in another tab finishes the old recording into its own tab, then starts the new one", () => {
		const { model, effects } = run([
			...listeningIn(A),
			{ type: "start", origin: B, mode: "insert" },
		]);
		expect(effects.slice(2)).toEqual([
			{ kind: "stopMic", jobId: 1, then: "transcribe" },
			{ kind: "notifyHandedOff", origin: A },
			{ kind: "openMic" },
		]);
		// lease is neither released nor re-acquired — this vault keeps it
		expect(model.jobs[0]).toMatchObject({ origin: A, mode: "insert" });
		expect(recordingOrigin(model)).toEqual(B);
		expect(captureStateFor(model, A)).toBe("transcribing");
		expect(captureStateFor(model, B)).toBe("listening");
	});

	it("a hand-off always inserts the old text, even if it was started as send", () => {
		const { model } = run([
			{ type: "start", origin: A, mode: "send" },
			{ type: "micOpened", now: 1 },
			{ type: "start", origin: B, mode: "insert" },
		]);
		expect(model.jobs[0].mode).toBe("insert");
	});

	it("another vault taking over finishes this recording into its tab", () => {
		const { model, effects } = run([...listeningIn(A), { type: "yield" }]);
		expect(effects.slice(2)).toEqual([
			{ kind: "stopMic", jobId: 1, then: "transcribe" },
			{ kind: "notifyHandedOff", origin: A },
		]);
		expect(model.recording).toBeNull();
	});

	it("yield before the mic opens just closes it", () => {
		const { effects } = run([
			{ type: "start", origin: A, mode: "insert" },
			{ type: "yield" },
		]);
		expect(effects.slice(2)).toEqual([{ kind: "closeMic" }]);
	});

	it("yield with nothing recording does nothing", () => {
		expect(run([{ type: "yield" }]).effects).toEqual([]);
	});
});

describe("tab closed (user already confirmed)", () => {
	it("closing the recording tab stops without keeping audio and frees the lease", () => {
		const { model, effects } = run([
			...listeningIn(A),
			{ type: "tabClosed", origin: A },
		]);
		expect(effects.slice(2)).toEqual([
			{ kind: "closeMic" },
			{ kind: "releaseLease" },
		]);
		expect(model.recording).toBeNull();
	});

	it("closing a tab drops its pending jobs and their audio", () => {
		const { model, effects } = run([
			...listeningIn(A),
			{ type: "stop" },
			{ type: "tabClosed", origin: A },
			{ type: "transcribed", jobId: 1, text: "late" },
		]);
		expect(effects).toContainEqual({ kind: "discardAudio", jobId: 1 });
		expect(effects.some((e) => e.kind === "deliver")).toBe(false);
		expect(model.jobs).toEqual([]);
	});

	it("closing another tab leaves the recording alone", () => {
		const { model, effects } = run([
			...listeningIn(A),
			{ type: "tabClosed", origin: B },
		]);
		expect(effects).toHaveLength(2);
		expect(recordingOrigin(model)).toEqual(A);
	});
});

describe("ignores events that don't apply", () => {
	it("late or unknown job events change nothing", () => {
		const base = run(listeningIn()).model;
		for (const e of [
			{ type: "transcribed", jobId: 9, text: "x" },
			{ type: "transcribeFailed", jobId: 9, message: "x" },
			{ type: "retry", jobId: 9 },
			{ type: "dismiss", jobId: 9 },
			{ type: "undo", jobId: 9 },
			{ type: "undoExpired", jobId: 9 },
			{ type: "micFailed", message: "late" },
		] as VoiceCaptureEvent[]) {
			const out = voiceCaptureReducer(base, e);
			expect(out.state).toEqual(base);
			expect(out.effects).toEqual([]);
		}
	});
});

describe("property: no silent audio loss", () => {
	const tab = fc.constantFrom(A, B);
	const jobId = fc.integer({ min: 1, max: 6 });
	// Weighted so recordings actually get created: a job needs start →
	// micOpened → stop/cancel/yield/hand-off. Unweighted, 500 runs produced
	// only ~24 recordings and the property missed a dropped-without-discard bug.
	const w = <T,>(weight: number, arbitrary: fc.Arbitrary<T>) => ({ weight, arbitrary });
	const event: fc.Arbitrary<VoiceCaptureEvent> = fc.oneof(
		w(4, fc.record({
			type: fc.constant("start" as const),
			origin: tab,
			mode: fc.constantFrom("insert" as const, "send" as const),
		})),
		w(4, fc.record({ type: fc.constant("micOpened" as const), now: fc.nat() })),
		w(2, fc.record({ type: fc.constant("micFailed" as const), message: fc.constant("x") })),
		w(3, fc.record({
			type: fc.constant("stop" as const),
			mode: fc.constantFrom(undefined, "insert" as const, "send" as const),
		})),
		w(2, fc.constant({ type: "cancel" } as const)),
		w(2, fc.constant({ type: "yield" } as const)),
		w(2, fc.record({ type: fc.constant("tabClosed" as const), origin: tab })),
		w(2, fc.record({ type: fc.constant("transcribed" as const), jobId, text: fc.constant("t") })),
		w(2, fc.record({
			type: fc.constant("transcribeFailed" as const),
			jobId,
			message: fc.constant("x"),
		})),
		w(2, fc.record({ type: fc.constant("retry" as const), jobId })),
		w(2, fc.record({ type: fc.constant("dismiss" as const), jobId })),
		w(2, fc.record({ type: fc.constant("undo" as const), jobId })),
		w(2, fc.record({ type: fc.constant("undoExpired" as const), jobId })),
	);

	it("every captured recording is live, delivered+discarded, or explicitly discarded", () => {
		fc.assert(
			fc.property(fc.array(event, { minLength: 10, maxLength: 60, size: "max" }), (events) => {
				const { model, effects } = run(events);
				const captured = new Set(
					effects.flatMap((e) => (e.kind === "stopMic" ? [e.jobId] : [])),
				);
				const discarded = effects.flatMap((e) =>
					e.kind === "discardAudio" ? [e.jobId] : [],
				);
				const live = new Set(model.jobs.map((j) => j.id));

				// Each captured job is accounted for exactly once.
				for (const id of captured) {
					const dropped = discarded.filter((d) => d === id).length;
					expect(live.has(id) ? 0 : 1).toBe(dropped);
				}
				// Nothing is discarded that was never captured.
				for (const id of discarded) expect(captured.has(id)).toBe(true);
				// Job ids are unique.
				expect(live.size).toBe(model.jobs.length);
			}),
			{ numRuns: 1000 },
		);
	});

	it("lease acquire/release stay balanced", () => {
		fc.assert(
			fc.property(fc.array(event, { minLength: 10, maxLength: 60, size: "max" }), (events) => {
				let model = initialVoiceCapture;
				let held = false;
				for (const e of events) {
					const out = voiceCaptureReducer(model, e);
					for (const fx of out.effects) {
						if (fx.kind === "acquireLease") {
							expect(held).toBe(false);
							held = true;
						}
						if (fx.kind === "releaseLease") {
							expect(held).toBe(true);
							held = false;
						}
					}
					// A yield hands the lease away without a local release.
					if (e.type === "yield" && model.recording !== null) held = false;
					model = out.state;
					// Holding the lease ⇔ a recording is in progress.
					expect(held).toBe(model.recording !== null);
				}
			}),
			{ numRuns: 1000 },
		);
	});
});

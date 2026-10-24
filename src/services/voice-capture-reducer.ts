/**
 * voice-capture-reducer — the single owner of this vault's recording slot and
 * the transcription jobs that come out of it (voice-input feature spec,
 * § Architecture Impact).
 *
 * Shape: a pure `(state, event) → { state, effects[] }` fold, like
 * queue-orchestration-reducer. The adapter (the plugin-level voice service)
 * performs the effects: opening and stopping the mic, running the engine,
 * talking to the lease, delivering text to a tab's composer. The reducer
 * never touches the mic or a composer itself.
 *
 * RULES
 *  - One recording per vault. `start` in another tab hands off: the old
 *    recording stops, becomes a job, and its text goes to its own tab
 *    (always inserted, never auto-sent, so the user can check it).
 *  - The lease is acquired when a recording starts from nothing and released
 *    when it ends here. A hand-off inside this vault keeps it. `yield` (another
 *    vault took it) ends the recording without a release.
 *  - No silent audio loss. Captured audio lives in a job until it is either
 *    delivered or explicitly dropped: Esc starts an undo window, a failed
 *    transcription waits for retry or dismiss, a closed tab (the user already
 *    confirmed) drops its jobs. Every drop is a `discardAudio` effect.
 *  - Audio is never captured before the mic reports open, so stopping in the
 *    `opening` state just closes the mic.
 *  - Events that don't apply (late or unknown job ids, a mic failure after
 *    the mic opened) change nothing.
 *
 * Pure — no React, no Obsidian, no DOM.
 */

export interface VoiceTab {
	leafId: string;
	tabId: string;
}

/** What happens to the text when this recording is transcribed. */
export type VoiceDeliveryMode = "insert" | "send";

export type VoiceRecording =
	| { status: "opening"; origin: VoiceTab; mode: VoiceDeliveryMode }
	| {
			status: "listening";
			origin: VoiceTab;
			mode: VoiceDeliveryMode;
			startedAt: number;
	  };

export type VoiceJob =
	| { id: number; origin: VoiceTab; mode: VoiceDeliveryMode; status: "transcribing" }
	| {
			id: number;
			origin: VoiceTab;
			mode: VoiceDeliveryMode;
			status: "failed";
			error: string;
	  }
	| { id: number; origin: VoiceTab; mode: VoiceDeliveryMode; status: "cancelled" };

export interface VoiceCaptureModel {
	readonly recording: VoiceRecording | null;
	readonly jobs: readonly VoiceJob[];
	readonly nextJobId: number;
	/** The mic couldn't open; shown in the tab that tried. */
	readonly micError: { origin: VoiceTab; message: string } | null;
}

export const initialVoiceCapture: VoiceCaptureModel = {
	recording: null,
	jobs: [],
	nextJobId: 1,
	micError: null,
};

export type VoiceCaptureEvent =
	| { type: "start"; origin: VoiceTab; mode: VoiceDeliveryMode }
	| { type: "micOpened"; now: number }
	| { type: "micFailed"; message: string }
	/** `mode` overrides the start mode (Mod+Enter = stop and send). */
	| { type: "stop"; mode?: VoiceDeliveryMode }
	| { type: "cancel" }
	/** Another vault took the lease. */
	| { type: "yield" }
	/** A tab closed; the user already confirmed if it was recording. */
	| { type: "tabClosed"; origin: VoiceTab }
	| { type: "transcribed"; jobId: number; text: string }
	| { type: "transcribeFailed"; jobId: number; message: string }
	| { type: "retry"; jobId: number }
	| { type: "dismiss"; jobId: number }
	| { type: "undo"; jobId: number }
	| { type: "undoExpired"; jobId: number };

export type VoiceCaptureEffect =
	| { kind: "acquireLease" }
	| { kind: "releaseLease" }
	| { kind: "openMic" }
	/** Close the mic without keeping audio. */
	| { kind: "closeMic" }
	/** Stop the mic, keep its audio under `jobId`, then transcribe or hold it. */
	| { kind: "stopMic"; jobId: number; then: "transcribe" | "hold" }
	| { kind: "transcribe"; jobId: number }
	| { kind: "deliver"; origin: VoiceTab; text: string; mode: VoiceDeliveryMode }
	| { kind: "discardAudio"; jobId: number }
	| { kind: "scheduleUndoExpiry"; jobId: number }
	| { kind: "notifyHandedOff"; origin: VoiceTab };

export interface VoiceCaptureResult {
	state: VoiceCaptureModel;
	effects: VoiceCaptureEffect[];
}

/** What a tab's mic shows, for `deriveVoiceAffordance`. */
export type VoiceTabCaptureState = "idle" | "listening" | "transcribing" | "error";

export function captureStateFor(
	model: VoiceCaptureModel,
	tab: VoiceTab,
): VoiceTabCaptureState {
	if (model.recording !== null && sameTab(model.recording.origin, tab)) {
		return "listening";
	}
	if (model.micError !== null && sameTab(model.micError.origin, tab)) {
		return "error";
	}
	const mine = model.jobs.filter((j) => sameTab(j.origin, tab));
	if (mine.some((j) => j.status === "failed")) return "error";
	if (mine.some((j) => j.status === "transcribing")) return "transcribing";
	return "idle";
}

/** The tab recording right now, for `deriveVoiceTarget`'s `local`. */
export function recordingOrigin(model: VoiceCaptureModel): VoiceTab | null {
	return model.recording?.origin ?? null;
}

const unchanged = (state: VoiceCaptureModel): VoiceCaptureResult => ({
	state,
	effects: [],
});

export function voiceCaptureReducer(
	state: VoiceCaptureModel,
	event: VoiceCaptureEvent,
): VoiceCaptureResult {
	switch (event.type) {
		case "start":
			return start(state, event.origin, event.mode);
		case "micOpened":
			if (state.recording?.status !== "opening") return unchanged(state);
			return {
				state: {
					...state,
					recording: { ...state.recording, status: "listening", startedAt: event.now },
				},
				effects: [],
			};
		case "micFailed":
			if (state.recording?.status !== "opening") return unchanged(state);
			return {
				state: {
					...state,
					recording: null,
					micError: { origin: state.recording.origin, message: event.message },
				},
				effects: [{ kind: "releaseLease" }],
			};
		case "stop": {
			const rec = state.recording;
			if (rec === null) return unchanged(state);
			if (rec.status === "opening") {
				return {
					state: { ...state, recording: null },
					effects: [{ kind: "closeMic" }, { kind: "releaseLease" }],
				};
			}
			const { state: next, jobId } = addJob(
				{ ...state, recording: null },
				rec.origin,
				event.mode ?? rec.mode,
				"transcribing",
			);
			return {
				state: next,
				effects: [
					{ kind: "stopMic", jobId, then: "transcribe" },
					{ kind: "releaseLease" },
				],
			};
		}
		case "cancel": {
			const rec = state.recording;
			if (rec === null) return unchanged(state);
			if (rec.status === "opening") {
				return {
					state: { ...state, recording: null },
					effects: [{ kind: "closeMic" }, { kind: "releaseLease" }],
				};
			}
			// Undo always inserts, so the user can check the text.
			const { state: next, jobId } = addJob(
				{ ...state, recording: null },
				rec.origin,
				"insert",
				"cancelled",
			);
			return {
				state: next,
				effects: [
					{ kind: "stopMic", jobId, then: "hold" },
					{ kind: "scheduleUndoExpiry", jobId },
					{ kind: "releaseLease" },
				],
			};
		}
		case "yield": {
			const rec = state.recording;
			if (rec === null) return unchanged(state);
			const ended = finishForHandOff({ ...state, recording: null }, rec);
			return ended;
		}
		case "tabClosed":
			return tabClosed(state, event.origin);
		case "transcribed": {
			const job = findJob(state, event.jobId, "transcribing");
			if (job === undefined) return unchanged(state);
			return {
				state: removeJob(state, job.id),
				effects: [
					{ kind: "deliver", origin: job.origin, text: event.text, mode: job.mode },
					{ kind: "discardAudio", jobId: job.id },
				],
			};
		}
		case "transcribeFailed": {
			const job = findJob(state, event.jobId, "transcribing");
			if (job === undefined) return unchanged(state);
			return {
				state: replaceJob(state, {
					id: job.id,
					origin: job.origin,
					mode: job.mode,
					status: "failed",
					error: event.message,
				}),
				effects: [],
			};
		}
		case "retry":
			return rerun(state, event.jobId, "failed");
		case "undo":
			return rerun(state, event.jobId, "cancelled");
		case "dismiss":
			return drop(state, event.jobId, "failed");
		case "undoExpired":
			return drop(state, event.jobId, "cancelled");
	}
}

function start(
	state: VoiceCaptureModel,
	origin: VoiceTab,
	mode: VoiceDeliveryMode,
): VoiceCaptureResult {
	const rec = state.recording;
	const fresh: VoiceRecording = { status: "opening", origin, mode };
	if (rec === null) {
		return {
			state: { ...state, recording: fresh, micError: null },
			effects: [{ kind: "acquireLease" }, { kind: "openMic" }],
		};
	}
	if (sameTab(rec.origin, origin)) return unchanged(state);
	// Hand-off inside this vault: finish the old one, keep the lease.
	const ended = finishForHandOff({ ...state, recording: null }, rec);
	return {
		state: { ...ended.state, recording: fresh, micError: null },
		effects: [...ended.effects, { kind: "openMic" }],
	};
}

/** End a recording because it's moving elsewhere; its text is inserted. */
function finishForHandOff(
	state: VoiceCaptureModel,
	rec: VoiceRecording,
): VoiceCaptureResult {
	if (rec.status === "opening") {
		return { state, effects: [{ kind: "closeMic" }] };
	}
	const { state: next, jobId } = addJob(state, rec.origin, "insert", "transcribing");
	return {
		state: next,
		effects: [
			{ kind: "stopMic", jobId, then: "transcribe" },
			{ kind: "notifyHandedOff", origin: rec.origin },
		],
	};
}

function tabClosed(state: VoiceCaptureModel, origin: VoiceTab): VoiceCaptureResult {
	const effects: VoiceCaptureEffect[] = [];
	let recording = state.recording;
	if (recording !== null && sameTab(recording.origin, origin)) {
		effects.push({ kind: "closeMic" }, { kind: "releaseLease" });
		recording = null;
	}
	const kept: VoiceJob[] = [];
	for (const job of state.jobs) {
		if (sameTab(job.origin, origin)) {
			effects.push({ kind: "discardAudio", jobId: job.id });
		} else {
			kept.push(job);
		}
	}
	const micError =
		state.micError !== null && sameTab(state.micError.origin, origin)
			? null
			: state.micError;
	if (effects.length === 0 && micError === state.micError) return unchanged(state);
	return { state: { ...state, recording, jobs: kept, micError }, effects };
}

function rerun(
	state: VoiceCaptureModel,
	jobId: number,
	from: "failed" | "cancelled",
): VoiceCaptureResult {
	const job = findJob(state, jobId, from);
	if (job === undefined) return unchanged(state);
	return {
		state: replaceJob(state, {
			id: job.id,
			origin: job.origin,
			mode: job.mode,
			status: "transcribing",
		}),
		effects: [{ kind: "transcribe", jobId }],
	};
}

function drop(
	state: VoiceCaptureModel,
	jobId: number,
	from: "failed" | "cancelled",
): VoiceCaptureResult {
	const job = findJob(state, jobId, from);
	if (job === undefined) return unchanged(state);
	return {
		state: removeJob(state, jobId),
		effects: [{ kind: "discardAudio", jobId }],
	};
}

function addJob(
	state: VoiceCaptureModel,
	origin: VoiceTab,
	mode: VoiceDeliveryMode,
	status: "transcribing" | "cancelled",
): { state: VoiceCaptureModel; jobId: number } {
	const id = state.nextJobId;
	const job: VoiceJob = { id, origin, mode, status };
	return {
		state: { ...state, jobs: [...state.jobs, job], nextJobId: id + 1 },
		jobId: id,
	};
}

function findJob<S extends VoiceJob["status"]>(
	state: VoiceCaptureModel,
	id: number,
	status: S,
): Extract<VoiceJob, { status: S }> | undefined {
	return state.jobs.find(
		(j): j is Extract<VoiceJob, { status: S }> => j.id === id && j.status === status,
	);
}

function replaceJob(state: VoiceCaptureModel, job: VoiceJob): VoiceCaptureModel {
	return { ...state, jobs: state.jobs.map((j) => (j.id === job.id ? job : j)) };
}

function removeJob(state: VoiceCaptureModel, id: number): VoiceCaptureModel {
	return { ...state, jobs: state.jobs.filter((j) => j.id !== id) };
}

function sameTab(a: VoiceTab, b: VoiceTab): boolean {
	return a.leafId === b.leafId && a.tabId === b.tabId;
}

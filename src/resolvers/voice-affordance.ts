/**
 * `deriveVoiceAffordance` — the single pure resolver for what voice input
 * offers in one tab: the mic button and the voice commands read the same
 * answer (spec: the voice-input feature spec § Architecture Impact).
 *
 * DESIGN
 *  - `buttonVisible` is separate from `state`. Hiding the mic button is a
 *    display choice; the commands keep working, so they must still see the
 *    real state (spec § Settings: "Off hides the button; the commands still
 *    work").
 *  - Only the tab that started the recording (the origin tab) shows
 *    listening / transcribing / error. Every other tab — in this vault or
 *    another — shows its normal state, because a click there hands the
 *    recording off rather than being blocked (spec § Multiple vaults and
 *    sessions).
 *  - Engine status gates everything that isn't the origin tab's live
 *    recording: a tab can't start a recording until setup is done. The order
 *    of setup steps is choose → install → model, matching first-run setup.
 *
 * Pure — no React, no Obsidian. Total over the input union.
 */

/** Whether speech-to-text can run right now, from the engine check. */
export type VoiceEngineStatus =
	| "ready" // engine + model found
	| "unconfigured" // no engine chosen yet
	| "engine-missing" // local engine chosen, whisper.cpp not found
	| "model-missing"; // whisper.cpp found, no model file

/** This vault's capture state machine value. */
export type VoiceCaptureState = "idle" | "listening" | "transcribing" | "error";

export type VoiceSetupStep = "choose-engine" | "install-engine" | "download-model";

export type VoiceAffordanceState =
	| { kind: "ready" }
	| { kind: "listening" }
	| { kind: "transcribing" }
	| { kind: "error" }
	| { kind: "setup-needed"; step: VoiceSetupStep };

export interface VoiceAffordanceInput {
	/** The "Show the mic button" setting. */
	showMicButton: boolean;
	engine: VoiceEngineStatus;
	capture: VoiceCaptureState;
	/** This tab started the active recording in this vault. */
	isOriginTab: boolean;
}

export interface VoiceAffordance {
	buttonVisible: boolean;
	state: VoiceAffordanceState;
}

export function deriveVoiceAffordance(
	input: VoiceAffordanceInput,
): VoiceAffordance {
	return {
		buttonVisible: input.showMicButton,
		state: deriveState(input),
	};
}

function deriveState(input: VoiceAffordanceInput): VoiceAffordanceState {
	if (input.isOriginTab) {
		switch (input.capture) {
			case "listening":
				return { kind: "listening" };
			case "transcribing":
				return { kind: "transcribing" };
			case "error":
				return { kind: "error" };
			case "idle":
				break;
		}
	}
	switch (input.engine) {
		case "ready":
			return { kind: "ready" };
		case "unconfigured":
			return { kind: "setup-needed", step: "choose-engine" };
		case "engine-missing":
			return { kind: "setup-needed", step: "install-engine" };
		case "model-missing":
			return { kind: "setup-needed", step: "download-model" };
	}
}

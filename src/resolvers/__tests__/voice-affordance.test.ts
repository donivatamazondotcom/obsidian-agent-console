/**
 * Truth table for `deriveVoiceAffordance` — what the mic button shows in one tab.
 *
 * Every combination of (engine status × capture state × origin-tab) is listed
 * explicitly in EXPECTED, so a new enum member without a classification here is
 * a compile error (the record is keyed on the full cross product).
 */
import { describe, it, expect } from "vitest";
import {
	deriveVoiceAffordance,
	type VoiceAffordanceState,
	type VoiceCaptureState,
	type VoiceEngineStatus,
} from "../voice-affordance";

type Key = `${VoiceEngineStatus}|${VoiceCaptureState}|${"origin" | "other"}`;

const READY: VoiceAffordanceState = { kind: "ready" };
const LISTENING: VoiceAffordanceState = { kind: "listening" };
const TRANSCRIBING: VoiceAffordanceState = { kind: "transcribing" };
const ERROR: VoiceAffordanceState = { kind: "error" };
const CHOOSE: VoiceAffordanceState = { kind: "setup-needed", step: "choose-engine" };
const INSTALL: VoiceAffordanceState = { kind: "setup-needed", step: "install-engine" };
const MODEL: VoiceAffordanceState = { kind: "setup-needed", step: "download-model" };

const EXPECTED: Record<Key, VoiceAffordanceState> = {
	// Nothing recording — engine status decides.
	"ready|idle|origin": READY,
	"ready|idle|other": READY,
	"unconfigured|idle|origin": CHOOSE,
	"unconfigured|idle|other": CHOOSE,
	"engine-missing|idle|origin": INSTALL,
	"engine-missing|idle|other": INSTALL,
	"model-missing|idle|origin": MODEL,
	"model-missing|idle|other": MODEL,

	// The tab that started the recording shows the recording, whatever the engine.
	"ready|listening|origin": LISTENING,
	"unconfigured|listening|origin": LISTENING,
	"engine-missing|listening|origin": LISTENING,
	"model-missing|listening|origin": LISTENING,
	"ready|transcribing|origin": TRANSCRIBING,
	"unconfigured|transcribing|origin": TRANSCRIBING,
	"engine-missing|transcribing|origin": TRANSCRIBING,
	"model-missing|transcribing|origin": TRANSCRIBING,
	"ready|error|origin": ERROR,
	"unconfigured|error|origin": ERROR,
	"engine-missing|error|origin": ERROR,
	"model-missing|error|origin": ERROR,

	// Any other tab: recording elsewhere does not lock this tab — a click here
	// hands off (spec § Multiple vaults and sessions). Engine status still gates.
	"ready|listening|other": READY,
	"ready|transcribing|other": READY,
	"ready|error|other": READY,
	"unconfigured|listening|other": CHOOSE,
	"unconfigured|transcribing|other": CHOOSE,
	"unconfigured|error|other": CHOOSE,
	"engine-missing|listening|other": INSTALL,
	"engine-missing|transcribing|other": INSTALL,
	"engine-missing|error|other": INSTALL,
	"model-missing|listening|other": MODEL,
	"model-missing|transcribing|other": MODEL,
	"model-missing|error|other": MODEL,
};

describe("deriveVoiceAffordance — full truth table", () => {
	for (const [key, expected] of Object.entries(EXPECTED) as [
		Key,
		VoiceAffordanceState,
	][]) {
		const [engine, capture, who] = key.split("|") as [
			VoiceEngineStatus,
			VoiceCaptureState,
			"origin" | "other",
		];
		it(key, () => {
			const out = deriveVoiceAffordance({
				showMicButton: true,
				engine,
				capture,
				isOriginTab: who === "origin",
			});
			expect(out.state).toEqual(expected);
		});
	}
});

describe("deriveVoiceAffordance — button visibility", () => {
	it("hiding the mic button never changes the state the commands read", () => {
		for (const [key, expected] of Object.entries(EXPECTED) as [
			Key,
			VoiceAffordanceState,
		][]) {
			const [engine, capture, who] = key.split("|") as [
				VoiceEngineStatus,
				VoiceCaptureState,
				"origin" | "other",
			];
			const out = deriveVoiceAffordance({
				showMicButton: false,
				engine,
				capture,
				isOriginTab: who === "origin",
			});
			expect(out.buttonVisible).toBe(false);
			expect(out.state).toEqual(expected);
		}
	});

	it("shows the button when the setting is on, even before setup", () => {
		const out = deriveVoiceAffordance({
			showMicButton: true,
			engine: "unconfigured",
			capture: "idle",
			isOriginTab: false,
		});
		expect(out.buttonVisible).toBe(true);
	});
});

/**
 * Exhaustive truth table for deriveComposerAffordances.
 *
 * The resolver is connection-state-independent (it does NOT read lazyState), so
 * the input space is 2 surfaces × 2 supportsImages × 2 hasConfigSelectors × 2
 * hasQuickPrompts = 16 combinations, all enumerated below, plus landmark
 * full-output cases for readability.
 */

import { describe, expect, it } from "vitest";
import {
	deriveComposerAffordances,
	composerCapabilitiesFromSession,
	type ComposerAffordancesInput,
	type ComposerSurface,
} from "../composer-affordances";
import type {
	SessionModeState,
	SessionModelState,
	SessionConfigOption,
} from "../../types/session";

const SURFACES: ComposerSurface[] = ["landing", "tab"];
const BOOLS = [true, false];

describe("deriveComposerAffordances — exhaustive truth table", () => {
	for (const surface of SURFACES) {
		for (const supportsImages of BOOLS) {
			for (const hasConfigSelectors of BOOLS) {
				for (const hasQuickPrompts of BOOLS) {
					const input: ComposerAffordancesInput = {
						surface,
						capabilities: { supportsImages, hasConfigSelectors },
						hasQuickPrompts,
					};
					const label = `${surface}/img=${supportsImages}/cfg=${hasConfigSelectors}/qp=${hasQuickPrompts}`;

					it(label, () => {
						const r = deriveComposerAffordances(input);

						if (surface === "landing") {
							// The landing is always a launcher.
							expect(r.sendMode).toBe("launch");
							expect(r.context).toBe("carry");
							expect(r.showAttachments).toBe(false);
							expect(r.showConfigSelectors).toBe(false);
							expect(r.quickPromptFire).toBe(
								hasQuickPrompts ? "launch" : "none",
							);
						} else {
							// Tab: send + quick prompts run in-session.
							expect(r.sendMode).toBe("session");
							expect(r.context).toBe("session");
							expect(r.quickPromptFire).toBe(
								hasQuickPrompts ? "current" : "none",
							);
							// Satellite controls follow data/capability ONLY —
							// no connection-state gate.
							expect(r.showAttachments).toBe(supportsImages);
							expect(r.showConfigSelectors).toBe(
								hasConfigSelectors,
							);
						}
					});
				}
			}
		}
	}
});

describe("deriveComposerAffordances — landmark cases", () => {
	it("landing with quick prompts: launch send + launch fire + carry, no satellite controls", () => {
		expect(
			deriveComposerAffordances({
				surface: "landing",
				capabilities: { supportsImages: true, hasConfigSelectors: true },
				hasQuickPrompts: true,
			}),
		).toEqual({
			sendMode: "launch",
			quickPromptFire: "launch",
			context: "carry",
			showAttachments: false, // forced off on the landing even if capable
			showConfigSelectors: false, // forced off on the landing even if capable
		});
	});

	it("landing without quick prompts: fire is 'none'", () => {
		const r = deriveComposerAffordances({
			surface: "landing",
			capabilities: { supportsImages: false, hasConfigSelectors: false },
			hasQuickPrompts: false,
		});
		expect(r.quickPromptFire).toBe("none");
	});

	it("tab: session send/fire, attachments + selectors per capability", () => {
		expect(
			deriveComposerAffordances({
				surface: "tab",
				capabilities: { supportsImages: true, hasConfigSelectors: true },
				hasQuickPrompts: true,
			}),
		).toEqual({
			sendMode: "session",
			quickPromptFire: "current",
			context: "session",
			showAttachments: true,
			showConfigSelectors: true,
		});
	});

	it("tab shows config selectors purely on data — no connection-state gate", () => {
		// Selectors show whenever there is data, regardless of any session
		// liveness (which this resolver deliberately does not read). This is the
		// fold-now #3 correction: presence keys off data, engaging triggers
		// acquisition (see Model Selection Under Lazy Acquisition).
		const r = deriveComposerAffordances({
			surface: "tab",
			capabilities: { supportsImages: false, hasConfigSelectors: true },
			hasQuickPrompts: false,
		});
		expect(r.showConfigSelectors).toBe(true);
	});

	it("tab hides selectors when there is no selector data", () => {
		const r = deriveComposerAffordances({
			surface: "tab",
			capabilities: { supportsImages: true, hasConfigSelectors: false },
			hasQuickPrompts: true,
		});
		expect(r.showConfigSelectors).toBe(false);
		expect(r.showAttachments).toBe(true);
	});
});


const modeState = (n: number): SessionModeState =>
	({
		availableModes: Array.from({ length: n }, (_, i) => ({
			id: `m${i}`,
			name: `M${i}`,
		})),
		currentModeId: null,
	}) as unknown as SessionModeState;

const modelState = (n: number): SessionModelState =>
	({
		availableModels: Array.from({ length: n }, (_, i) => ({
			modelId: `x${i}`,
			name: `X${i}`,
		})),
		currentModelId: null,
	}) as unknown as SessionModelState;

const cfg = (n: number): SessionConfigOption[] =>
	Array.from({ length: n }, () => ({}) as unknown as SessionConfigOption);

describe("composerCapabilitiesFromSession — session → composer capabilities", () => {
	it("an empty session offers neither images nor selectors", () => {
		expect(composerCapabilitiesFromSession({})).toEqual({
			supportsImages: false,
			hasConfigSelectors: false,
		});
	});

	it("supportsImages tracks session.promptCapabilities.image", () => {
		expect(
			composerCapabilitiesFromSession({ promptCapabilities: { image: true } })
				.supportsImages,
		).toBe(true);
		expect(
			composerCapabilitiesFromSession({ promptCapabilities: {} })
				.supportsImages,
		).toBe(false);
	});

	it("hasConfigSelectors is true when modes, models, OR configOptions have entries", () => {
		expect(
			composerCapabilitiesFromSession({ modes: modeState(2) }).hasConfigSelectors,
		).toBe(true);
		expect(
			composerCapabilitiesFromSession({ models: modelState(2) }).hasConfigSelectors,
		).toBe(true);
		expect(
			composerCapabilitiesFromSession({ configOptions: cfg(1) }).hasConfigSelectors,
		).toBe(true);
	});

	it("hasConfigSelectors is false when all selector sources are empty", () => {
		expect(
			composerCapabilitiesFromSession({
				modes: modeState(0),
				models: modelState(0),
				configOptions: cfg(0),
			}).hasConfigSelectors,
		).toBe(false);
	});

	it("COARSE by design: a single-option mode still reports hasConfigSelectors true — InputToolbar's >1 fine-gate is the final arbiter of what renders, so routing this coarse flag is byte-identical", () => {
		expect(
			composerCapabilitiesFromSession({ modes: modeState(1) }).hasConfigSelectors,
		).toBe(true);
	});
});

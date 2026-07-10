/**
 * Exhaustive truth table for deriveComposerAffordances.
 *
 * Enumerates every input combination (2 surfaces × 6 lazyStates × 2
 * supportsImages × 2 hasConfigSelectors × 2 hasQuickPrompts = 96) and asserts
 * the resolved affordances against independent per-surface invariants, plus a
 * handful of landmark full-output cases for readability.
 */

import { describe, expect, it } from "vitest";
import {
	deriveComposerAffordances,
	type ComposerAffordancesInput,
	type ComposerSurface,
} from "../composer-affordances";
import type { TabSessionState } from "../../hooks/useTabSessionState";

const SURFACES: ComposerSurface[] = ["landing", "tab"];
const STATES: TabSessionState[] = [
	"idle",
	"connecting",
	"ready",
	"busy",
	"permission",
	"error",
];
const BOOLS = [true, false];

// Independent restatement of send-affordance's `isSessionLive` so the oracle
// does not import the implementation under test's helper.
const LIVE_STATES = new Set<TabSessionState>(["ready", "busy", "permission"]);

describe("deriveComposerAffordances — exhaustive truth table", () => {
	for (const surface of SURFACES) {
		for (const lazyState of STATES) {
			for (const supportsImages of BOOLS) {
				for (const hasConfigSelectors of BOOLS) {
					for (const hasQuickPrompts of BOOLS) {
						const input: ComposerAffordancesInput = {
							surface,
							lazyState,
							capabilities: {
								supportsImages,
								hasConfigSelectors,
							},
							hasQuickPrompts,
						};
						const label = `${surface}/${lazyState}/img=${supportsImages}/cfg=${hasConfigSelectors}/qp=${hasQuickPrompts}`;

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
								// Attachments follow the image capability, no
								// liveness gate.
								expect(r.showAttachments).toBe(supportsImages);
								// Selectors follow their data AND require a live
								// session (acting on the agent).
								expect(r.showConfigSelectors).toBe(
									LIVE_STATES.has(lazyState) &&
										hasConfigSelectors,
								);
							}
						});
					}
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
				lazyState: "idle",
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
			lazyState: "idle",
			capabilities: { supportsImages: false, hasConfigSelectors: false },
			hasQuickPrompts: false,
		});
		expect(r.quickPromptFire).toBe("none");
	});

	it("live tab: session send/fire, attachments + selectors per capability", () => {
		expect(
			deriveComposerAffordances({
				surface: "tab",
				lazyState: "ready",
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

	it("idle tab hides config selectors even when data exists (not live) but keeps attachments", () => {
		const r = deriveComposerAffordances({
			surface: "tab",
			lazyState: "idle",
			capabilities: { supportsImages: true, hasConfigSelectors: true },
			hasQuickPrompts: false,
		});
		expect(r.showConfigSelectors).toBe(false); // idle is not live
		expect(r.showAttachments).toBe(true); // attachments not liveness-gated
		expect(r.quickPromptFire).toBe("none");
	});

	it("error tab hides config selectors (acting on a dead session)", () => {
		const r = deriveComposerAffordances({
			surface: "tab",
			lazyState: "error",
			capabilities: { supportsImages: false, hasConfigSelectors: true },
			hasQuickPrompts: true,
		});
		expect(r.showConfigSelectors).toBe(false);
	});

	it("permission and busy count as live for selectors", () => {
		for (const lazyState of ["busy", "permission"] as TabSessionState[]) {
			expect(
				deriveComposerAffordances({
					surface: "tab",
					lazyState,
					capabilities: {
						supportsImages: false,
						hasConfigSelectors: true,
					},
					hasQuickPrompts: false,
				}).showConfigSelectors,
			).toBe(true);
		}
	});
});

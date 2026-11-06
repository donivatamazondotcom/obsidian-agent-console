/**
 * I270: `historyLaunchKey` is the one decision for which launch Session
 * history reads capabilities and server rows for. Truth table.
 */
import { describe, it, expect } from "vitest";
import { historyLaunchKey } from "../history-launch-key";

describe("historyLaunchKey", () => {
	it("a ready process uses its live key and its live capabilities", () => {
		for (const state of ["ready", "busy"] as const) {
			expect(
				historyLaunchKey({ liveLaunchKey: "v3|kiro-cli", sessionState: state, nextLaunchKey: () => "v2|kiro-cli" }),
			).toEqual({ kind: "live", key: "v3|kiro-cli", useLiveCapabilities: true });
		}
	});

	it("a process still starting uses its live key but not capabilities it hasn't reported", () => {
		for (const state of ["initializing", "authenticating"] as const) {
			expect(
				historyLaunchKey({ liveLaunchKey: "v3|kiro-cli", sessionState: state, nextLaunchKey: () => "v2|kiro-cli" }),
			).toEqual({ kind: "live", key: "v3|kiro-cli", useLiveCapabilities: false });
		}
	});

	it("with no process up, the launch a connect would make", () => {
		for (const state of ["disconnected", "error"] as const) {
			expect(
				historyLaunchKey({ liveLaunchKey: "v3|kiro-cli", sessionState: state, nextLaunchKey: () => "v2|kiro-cli" }),
			).toEqual({ kind: "next", key: "v2|kiro-cli", useLiveCapabilities: false });
		}

	});

	it("a live process never looks up the next launch", () => {
		let called = false;
		historyLaunchKey({
			liveLaunchKey: "v3|kiro-cli",
			sessionState: "ready",
			nextLaunchKey: () => {
				called = true;
				return "v2|kiro-cli";
			},
		});
		expect(called).toBe(false);
	});

	it("a ready process with no key (unpinned old CLI) answers for itself, unkeyed", () => {
		expect(
			historyLaunchKey({ liveLaunchKey: null, sessionState: "ready", nextLaunchKey: () => "v2|kiro-cli" }),
		).toEqual({ kind: "unkeyed", key: null, useLiveCapabilities: true });
	});

	it("an unconfigured agent with no process has none", () => {
		expect(
			historyLaunchKey({ liveLaunchKey: null, sessionState: "disconnected", nextLaunchKey: () => null }),
		).toEqual({ kind: "none", key: null, useLiveCapabilities: false });
	});
});

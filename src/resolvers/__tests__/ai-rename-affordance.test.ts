import { describe, it, expect } from "vitest";
import {
	deriveAiRenameAffordance,
	type AiRenameAffordance,
} from "../ai-rename-affordance";

/**
 * I210 — "Rename with AI" opens a side session on the tab's live process.
 * An agent that can't close it (Kiro V2) keeps a full MCP set alive for it
 * until the tab closes, so the action is disabled there. Full truth table.
 */
describe("deriveAiRenameAffordance", () => {
	const rows: Array<{
		initialized: boolean;
		closesSessions: boolean;
		inFlight: boolean;
		expected: AiRenameAffordance;
	}> = [
		// A rename already running wins over everything.
		{ initialized: true, closesSessions: true, inFlight: true, expected: { kind: "disabled", reason: "in-flight" } },
		{ initialized: true, closesSessions: false, inFlight: true, expected: { kind: "disabled", reason: "in-flight" } },
		{ initialized: false, closesSessions: false, inFlight: true, expected: { kind: "disabled", reason: "in-flight" } },
		{ initialized: false, closesSessions: true, inFlight: true, expected: { kind: "disabled", reason: "in-flight" } },
		// Connected: capability decides.
		{ initialized: true, closesSessions: true, inFlight: false, expected: { kind: "enabled" } },
		{ initialized: true, closesSessions: false, inFlight: false, expected: { kind: "disabled", reason: "agent-cannot-close" } },
		// Not connected yet: capabilities unknown → enabled (the click reports "not ready").
		{ initialized: false, closesSessions: false, inFlight: false, expected: { kind: "enabled" } },
		{ initialized: false, closesSessions: true, inFlight: false, expected: { kind: "enabled" } },
	];

	it.each(rows)(
		"initialized=$initialized closesSessions=$closesSessions inFlight=$inFlight",
		({ initialized, closesSessions, inFlight, expected }) => {
			expect(
				deriveAiRenameAffordance({ initialized, closesSessions, inFlight }),
			).toEqual(expected);
		},
	);
});

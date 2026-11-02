/** I260 — truth table for the history view's capability source. */
import { describe, it, expect } from "vitest";
import { resolveHistoryCapabilities } from "../history-capabilities";
import { NO_AGENT_CAPABILITIES } from "../../types/session";
import type { AgentCapabilities } from "../../types/session";

const A: AgentCapabilities = { ...NO_AGENT_CAPABILITIES, listsSessions: true };
const B: AgentCapabilities = { ...NO_AGENT_CAPABILITIES, restoresViaResume: true };

describe("resolveHistoryCapabilities", () => {
	it("live wins over cached", () => {
		expect(resolveHistoryCapabilities(A, B)).toEqual({ kind: "live", capabilities: A });
	});
	it("live alone is live", () => {
		expect(resolveHistoryCapabilities(B, undefined)).toEqual({ kind: "live", capabilities: B });
	});
	it("cached is used before connect", () => {
		expect(resolveHistoryCapabilities(undefined, A)).toEqual({ kind: "cached", capabilities: A });
	});
	it("neither is unknown, with the all-false record", () => {
		expect(resolveHistoryCapabilities(undefined, undefined)).toEqual({
			kind: "unknown",
			capabilities: NO_AGENT_CAPABILITIES,
		});
	});
});

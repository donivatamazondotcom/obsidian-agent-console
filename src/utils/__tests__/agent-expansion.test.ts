import { describe, it, expect } from "vitest";
import {
	freshAgentExpansion,
	syncAgentExpansion,
	toggleAgentExpansion,
} from "../agent-expansion";

describe("agent-expansion", () => {
	it("seeds only the default agent on first render (T01)", () => {
		const s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		expect([...s.expanded]).toEqual(["claude-code-acp"]);
		expect(s.initialized).toBe(true);
		expect(s.lastDefaultAgentId).toBe("claude-code-acp");
	});

	it("preserves user toggles across re-renders with an unchanged default (T02)", () => {
		let s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		s = toggleAgentExpansion(s, "codex-acp", true); // user expands Codex
		const after = syncAgentExpansion(s, "claude-code-acp"); // re-render, same default
		expect(after).toBe(s); // unchanged reference
		expect(after.expanded.has("codex-acp")).toBe(true);
		expect(after.expanded.has("claude-code-acp")).toBe(true);
	});

	it("moves expansion to the new default when the default changes (T03)", () => {
		let s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		s = syncAgentExpansion(s, "codex-acp"); // default changed to Codex
		expect(s.expanded.has("codex-acp")).toBe(true);
		expect(s.expanded.has("claude-code-acp")).toBe(false);
		expect(s.lastDefaultAgentId).toBe("codex-acp");
	});

	it("a manual collapse of the default wins for the session (open question)", () => {
		let s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		s = toggleAgentExpansion(s, "claude-code-acp", false); // user collapses default
		const after = syncAgentExpansion(s, "claude-code-acp"); // re-render, same default
		expect(after.expanded.has("claude-code-acp")).toBe(false);
	});

	it("default change preserves an unrelated agent's user-expanded state", () => {
		let s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		s = toggleAgentExpansion(s, "gemini-cli", true); // user expands Gemini
		s = syncAgentExpansion(s, "codex-acp"); // default → Codex
		expect(s.expanded.has("gemini-cli")).toBe(true); // untouched
		expect(s.expanded.has("codex-acp")).toBe(true);
		expect(s.expanded.has("claude-code-acp")).toBe(false);
	});

	it("fresh state after hide() reopens with only the (new) default (T04 reopen-reset)", () => {
		// Simulate: expand several, then hide() → freshAgentExpansion(), reopen.
		let s = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		s = toggleAgentExpansion(s, "codex-acp", true);
		s = toggleAgentExpansion(s, "gemini-cli", true);
		// hide() resets:
		const reopened = syncAgentExpansion(freshAgentExpansion(), "claude-code-acp");
		expect([...reopened.expanded]).toEqual(["claude-code-acp"]);
	});
});

/**
 * I224 / I227 — the session-title resolver: local > agent > none.
 * Exhaustive over the input classes each rung can take.
 */
import { describe, it, expect } from "vitest";
import {
	resolveSessionTitle,
	overlayLocalTitles,
	isPlaceholderAgentTitle,
} from "../session-title";
import type { SavedSessionInfo, SessionInfo } from "../../types/session";

const LOCAL = "I219 renamed BRAVO";
const AGENT = "Build Obsidian Agent Console Smoke Test";
const PLACEHOLDER = "<obsidian_system_instruction>";
const MENTION = "[@Plan](file:///vault/Plan.md)";

describe("resolveSessionTitle", () => {
	const localCases = [
		["usable", LOCAL],
		["empty", ""],
		["whitespace", "  "],
		["missing", undefined],
		["null", null],
	] as const;
	const agentCases = [
		["usable", AGENT],
		["kiro placeholder", PLACEHOLDER],
		["claude mention", MENTION],
		["empty", ""],
		["missing", undefined],
		["null", null],
	] as const;

	for (const [lName, localTitle] of localCases) {
		for (const [aName, agentTitle] of agentCases) {
			it(`local ${lName} × agent ${aName}`, () => {
				const r = resolveSessionTitle({ localTitle, agentTitle });
				if (lName === "usable") {
					expect(r).toEqual({ kind: "local", title: LOCAL });
				} else if (aName === "usable") {
					expect(r).toEqual({ kind: "agent", title: AGENT });
				} else {
					expect(r).toEqual({ kind: "none" });
				}
			});
		}
	}

	it("keeps the placeholder rule shared with the saved record (I223/I242)", () => {
		expect(isPlaceholderAgentTitle(PLACEHOLDER)).toBe(true);
		expect(isPlaceholderAgentTitle(MENTION)).toBe(true);
		expect(isPlaceholderAgentTitle(AGENT)).toBe(false);
	});
});

describe("overlayLocalTitles", () => {
	const saved = (
		sessionId: string,
		agentId: string,
		cwd: string,
	): SavedSessionInfo => ({
		sessionId,
		agentId,
		cwd,
		title: LOCAL,
		createdAt: "",
		updatedAt: "",
	});
	const row: SessionInfo = { sessionId: "s1", cwd: "/vault", title: AGENT };

	it("matches the record by id, regardless of its folder", () => {
		const [r] = overlayLocalTitles([row], [saved("s1", "kiro", "/other")], "kiro");
		expect(r.title).toBe(LOCAL);
	});

	it("ignores another agent's record with the same id", () => {
		const [r] = overlayLocalTitles([row], [saved("s1", "claude", "/vault")], "kiro");
		expect(r.title).toBe(AGENT);
	});

	it("leaves the rest of the row unchanged", () => {
		const [r] = overlayLocalTitles([row], [], "kiro");
		expect(r).toEqual(row);
	});
});

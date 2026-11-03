/**
 * I269 — the record-identity primitives: the one lookup, the validator and
 * the one-time migration. Pure functions; literals only (R5).
 */
import { describe, expect, it, vi } from "vitest";

import {
	findSessionRecord,
	normalizeSavedSessions,
	validateSavedSession,
	validateSavedSessions,
} from "../session-record";
import type { SavedSessionInfo } from "../../types/session";

function rec(
	recordId: string,
	sessionId: string,
	extra: Partial<SavedSessionInfo> = {},
): SavedSessionInfo {
	return {
		recordId,
		sessionId,
		agentId: "kiro",
		cwd: "/vault",
		title: `t-${recordId}`,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...extra,
	};
}

describe("findSessionRecord", () => {
	// A was rebound from x to y; B is the abandoned x reopened in a new tab.
	const A = rec("x", "y");
	const B = rec("u-1", "x");
	const records = [A, B];

	it("by sessionId matches only the current agent id", () => {
		expect(findSessionRecord(records, { by: "sessionId", id: "x" })).toBe(B);
		expect(findSessionRecord(records, { by: "sessionId", id: "y" })).toBe(A);
	});

	it("by recordId matches only the record id", () => {
		expect(findSessionRecord(records, { by: "recordId", id: "x" })).toBe(A);
		expect(findSessionRecord(records, { by: "recordId", id: "y" })).toBeUndefined();
	});

	it("an empty id matches nothing", () => {
		expect(findSessionRecord(records, { by: "sessionId", id: "" })).toBeUndefined();
	});
});

describe("validateSavedSession(s)", () => {
	it("accepts a well-formed record", () => {
		expect(validateSavedSession(rec("r1", "s1"), [rec("r2", "s2")])).toEqual([]);
	});

	it("rejects a duplicate record id or session id against the others", () => {
		const others = [rec("r1", "s1")];
		expect(validateSavedSession(rec("r1", "s9"), others)).toEqual([
			"duplicate recordId r1",
		]);
		expect(validateSavedSession(rec("r9", "s1"), others)).toEqual([
			"duplicate sessionId s1",
		]);
	});

	it("rejects an empty record id, session id or agent id", () => {
		expect(
			validateSavedSession(rec("", "", { agentId: "" }), []),
		).toEqual(["missing recordId", "missing sessionId", "missing agentId"]);
	});

	it("the array validator reports every violation", () => {
		expect(
			validateSavedSessions([rec("r1", "s1"), rec("r1", "s2"), rec("r3", "s2")]),
		).toEqual(["duplicate recordId r1", "duplicate sessionId s2"]);
	});
});

describe("normalizeSavedSessions (one-time migration)", () => {
	const legacy = {
		sessionId: "s1",
		agentId: "kiro",
		cwd: "/vault",
		title: "Old chat",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-02T00:00:00.000Z",
	};

	it("old format: the record id becomes the session id (its file name)", () => {
		const warn = vi.fn();
		expect(normalizeSavedSessions([legacy], warn)).toEqual([
			{ ...legacy, recordId: "s1" },
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("running it twice is a no-op", () => {
		const once = normalizeSavedSessions([legacy, rec("u-1", "s2")], vi.fn());
		expect(normalizeSavedSessions(once, vi.fn())).toEqual(once);
	});

	it("a migrated record keeps its record id", () => {
		expect(normalizeSavedSessions([rec("x", "y")], vi.fn())).toEqual([
			rec("x", "y"),
		]);
	});

	it("drops and logs each corrupt kind, never coerces", () => {
		const warn = vi.fn();
		const out = normalizeSavedSessions(
			[
				"not an object",
				null,
				{ ...legacy, sessionId: 42 },
				{ ...legacy, sessionId: "s3", agentId: undefined },
				{ ...legacy, sessionId: "s4", recordId: 7 },
				legacy,
			],
			warn,
		);
		expect(out).toEqual([{ ...legacy, recordId: "s1" }]);
		expect(warn).toHaveBeenCalledTimes(5);
	});

	it("a duplicate keeps the most recently updated record and logs", () => {
		const warn = vi.fn();
		const older = rec("r1", "s1", { updatedAt: "2026-10-01T00:00:00.000Z" });
		const newer = rec("r2", "s1", { updatedAt: "2026-10-05T00:00:00.000Z" });
		expect(normalizeSavedSessions([older, newer], warn)).toEqual([newer]);
		const sameRecord = rec("r2", "s9", { updatedAt: "2026-09-01T00:00:00.000Z" });
		expect(normalizeSavedSessions([newer, sameRecord], warn)).toEqual([newer]);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it("a non-array is no history", () => {
		expect(normalizeSavedSessions(undefined, vi.fn())).toEqual([]);
	});
});

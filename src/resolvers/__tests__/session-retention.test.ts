/**
 * I202: pure retention decisions for saved chats.
 *
 * `selectEvictions` picks which saved-session records leave the list when it
 * is over the cap: least recently updated first, never a record a tab uses.
 * `selectUnusedSessionFiles` picks transcript files the cleanup command may
 * move to the trash. `parseMaxSavedSessions` validates the setting.
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_SAVED_SESSIONS,
	decideCapChange,
	formatSize,
	parseMaxSavedSessions,
	selectEvictions,
	selectUnusedSessionFiles,
	sessionFileStem,
	tabSessionIds,
	UNUSED_FILE_MIN_AGE_MS,
} from "../session-retention";

function rec(sessionId: string, updatedAt: string) {
	return { sessionId, updatedAt };
}

describe("selectEvictions (I202)", () => {
	const list = [
		rec("new", "2026-11-03T10:00:00Z"),
		rec("b", "2026-11-01T10:00:00Z"),
		rec("old-but-active", "2026-11-02T10:00:00Z"),
		rec("a", "2026-10-01T10:00:00Z"),
	];

	it("keeps everything at or under the cap", () => {
		expect(selectEvictions(list, 4, new Set()).evicted).toEqual([]);
		expect(selectEvictions(list, 10, new Set()).kept).toEqual(list);
	});

	it("never evicts with an unlimited cap", () => {
		expect(selectEvictions(list, null, new Set())).toEqual({
			kept: list,
			evicted: [],
		});
	});

	it("evicts the least recently updated, not the last in insertion order", () => {
		const { kept, evicted } = selectEvictions(list, 3, new Set());
		expect(evicted.map((s) => s.sessionId)).toEqual(["a"]);
		expect(kept.map((s) => s.sessionId)).toEqual([
			"new",
			"b",
			"old-but-active",
		]);
		// "old-but-active" sits last-but-one by insertion yet was updated
		// after "b": the insertion-tail pop would have dropped "a" here too,
		// so check the case where they disagree.
		const tailIsRecent = [
			rec("new", "2026-11-03T10:00:00Z"),
			rec("stale", "2026-09-01T10:00:00Z"),
			rec("continued", "2026-11-02T10:00:00Z"),
		];
		expect(
			selectEvictions(tailIsRecent, 2, new Set()).evicted.map(
				(s) => s.sessionId,
			),
		).toEqual(["stale"]);
	});

	it("skips records a tab uses and evicts the next eligible one", () => {
		const { evicted } = selectEvictions(list, 3, new Set(["a"]));
		expect(evicted.map((s) => s.sessionId)).toEqual(["b"]);
	});

	it("stays over the cap when every candidate is protected", () => {
		const { kept, evicted } = selectEvictions(
			list,
			1,
			new Set(["new", "b", "old-but-active", "a"]),
		);
		expect(evicted).toEqual([]);
		expect(kept).toEqual(list);
	});

	it("evicts several when the cap drops by more than one, keeping order", () => {
		const { kept, evicted } = selectEvictions(list, 2, new Set());
		expect(evicted.map((s) => s.sessionId).sort()).toEqual(["a", "b"]);
		expect(kept.map((s) => s.sessionId)).toEqual(["new", "old-but-active"]);
	});

	it("treats an unreadable updatedAt as oldest", () => {
		const odd = [rec("ok", "2026-11-03T10:00:00Z"), rec("bad", "not a date")];
		expect(
			selectEvictions(odd, 1, new Set()).evicted.map((s) => s.sessionId),
		).toEqual(["bad"]);
	});

	it("breaks updatedAt ties by evicting the later list entry first", () => {
		const tie = [
			rec("x", "2026-10-01T10:00:00Z"),
			rec("y", "2026-10-01T10:00:00Z"),
		];
		expect(
			selectEvictions(tie, 1, new Set()).evicted.map((s) => s.sessionId),
		).toEqual(["y"]);
	});
});

describe("selectUnusedSessionFiles (I202)", () => {
	const now = Date.parse("2026-11-03T12:00:00Z");
	const old = now - UNUSED_FILE_MIN_AGE_MS - 1;
	const fresh = now - 60_000;

	it("selects only unreferenced files at least the minimum age", () => {
		const picked = selectUnusedSessionFiles({
			files: [
				{ stem: "orphan", mtime: old, size: 10 },
				{ stem: "in-index", mtime: old, size: 20 },
				{ stem: "just-written", mtime: fresh, size: 30 },
			],
			referencedStems: new Set(["in-index"]),
			now,
			minAgeMs: UNUSED_FILE_MIN_AGE_MS,
		});
		expect(picked.map((f) => f.stem)).toEqual(["orphan"]);
	});
});

describe("tabSessionIds / sessionFileStem (I202)", () => {
	it("collects every persisted tab session id across leaves", () => {
		const ids = tabSessionIds([
			{
				leafId: "l1",
				activeTabId: "t1",
				tabs: [
					{ tabId: "t1", agentId: "test-agent", label: "", sessionId: "s1", tabOrder: 0, scrollPosition: 0 },
					{ tabId: "t2", agentId: "test-agent", label: "", sessionId: null, tabOrder: 1, scrollPosition: 0 },
				],
			},
			{
				leafId: "l2",
				activeTabId: "t3",
				tabs: [
					{ tabId: "t3", agentId: "test-agent", label: "", sessionId: "s2", tabOrder: 0, scrollPosition: 0 },
				],
			},
		]);
		expect([...ids].sort()).toEqual(["s1", "s2"]);
		expect(tabSessionIds(undefined).size).toBe(0);
	});

	it("maps a session id to its file name the same way storage does", () => {
		expect(sessionFileStem("abc-1_2")).toBe("abc-1_2");
		expect(sessionFileStem("a/b:c")).toBe("a_b_c");
	});
});

describe("formatSize (I202)", () => {
	it("reads as KB, MB or GB", () => {
		expect(formatSize(10)).toBe("1 KB");
		expect(formatSize(512 * 1024)).toBe("512 KB");
		expect(formatSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
		expect(formatSize(666.4 * 1024 * 1024)).toBe("666.4 MB");
		expect(formatSize(1.2 * 1024 ** 3)).toBe("1.2 GB");
	});
});

describe("parseMaxSavedSessions (I202)", () => {
	it("defaults to 100 when unset", () => {
		expect(DEFAULT_MAX_SAVED_SESSIONS).toBe(100);
		expect(parseMaxSavedSessions(undefined)).toEqual({ cap: 100, valid: true });
	});

	it("reads null as unlimited", () => {
		expect(parseMaxSavedSessions(null)).toEqual({ cap: null, valid: true });
	});

	it("accepts the offered values", () => {
		for (const n of [25, 50, 100, 250, 500]) {
			expect(parseMaxSavedSessions(n)).toEqual({ cap: n, valid: true });
		}
	});

	it("falls back to the default and flags anything else", () => {
		for (const bad of [0, -5, 7, 1e9, "100", true, {}]) {
			expect(parseMaxSavedSessions(bad)).toEqual({ cap: 100, valid: false });
		}
	});
});

describe("decideCapChange (I202 / I239: the dropdown handler)", () => {
	const countFor = (cap: number | null) => (cap === null ? 0 : cap === 25 ? 3 : 0);

	it("resets on a value the dropdown doesn't offer, with no dialog", () => {
		for (const v of ["", "10", "0", "abc"]) {
			expect(decideCapChange(v, 100, countFor)).toEqual({ kind: "reset" });
		}
	});

	it("applies with no dialog when nothing would be moved", () => {
		expect(decideCapChange("unlimited", 100, countFor)).toEqual({ kind: "apply", cap: null });
		expect(decideCapChange("250", 100, countFor)).toEqual({ kind: "apply", cap: 250 });
	});

	it("asks first, with the count, when chats would be moved", () => {
		expect(decideCapChange("25", 100, countFor)).toEqual({ kind: "confirm", cap: 25, count: 3 });
	});

	it("does nothing when the value didn't change", () => {
		expect(decideCapChange("100", 100, countFor)).toEqual({ kind: "none" });
		expect(decideCapChange("unlimited", null, countFor)).toEqual({ kind: "none" });
	});
});

describe("selectEvictions and tabSessionIds with record ids (I269)", () => {
	it("a record protected only by its record id is kept", () => {
		const a = { recordId: "rec-a", sessionId: "s-old", updatedAt: "2026-10-01T00:00:00Z" };
		const b = { recordId: "rec-b", sessionId: "s-b", updatedAt: "2026-10-02T00:00:00Z" };
		const { kept, evicted } = selectEvictions([b, a], 1, new Set(["rec-a"]));
		expect(kept).toEqual([a]);
		expect(evicted).toEqual([b]);
	});

	it("tabSessionIds collects a closed panel's record ids too", () => {
		const ids = tabSessionIds([
			{
				leafId: "l",
				activeTabId: "t",
				tabs: [
					{
						tabId: "t",
						agentId: "test-agent",
						label: "x",
						sessionId: "s-new",
						recordId: "rec-a",
						tabOrder: 0,
						scrollPosition: 0,
					},
				],
			},
		]);
		expect([...ids].sort()).toEqual(["rec-a", "s-new"]);
	});
});

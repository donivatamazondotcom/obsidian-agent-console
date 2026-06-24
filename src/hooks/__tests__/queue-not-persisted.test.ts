/**
 * T8 — `isQueued` is runtime-only and MUST NOT be persisted (#82). The composer
 * text is the single source of truth, persisted for free by per-tab
 * draft-preservation; the queue adds no persisted field. So a pending message
 * degrades to a plain preserved draft across any turn-destroying boundary
 * (close/reopen, restart) — there is nothing to auto-fire into after the turn
 * is gone.
 *
 * Guard: assert the persisted tab shape never references the queue. If a future
 * change adds a queue field to PersistedTabInfo, this fails — flagging that the
 * degradation invariant has been broken.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tabTypes = readFileSync(
	resolve(__dirname, "../../types/tab.ts"),
	"utf8",
);

describe("queue is never persisted (T8)", () => {
	it("PersistedTabInfo carries no queue field", () => {
		// Isolate the PersistedTabInfo interface body.
		const start = tabTypes.indexOf("interface PersistedTabInfo");
		expect(start).toBeGreaterThan(-1);
		const body = tabTypes.slice(start, tabTypes.indexOf("}", start));
		expect(body).not.toMatch(/queue|isQueued/i);
	});

	it("the persisted draft field (the degradation seam) is still present", () => {
		// Degradation relies on draftText surviving — confirm the seam exists.
		expect(tabTypes).toContain("draftText");
	});
});

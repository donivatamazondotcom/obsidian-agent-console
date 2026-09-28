/**
 * F15 — Rename Tab With AI: the apply decision (manual rename wins, collision
 * suffix, missing title / closed tab).
 */
import { describe, expect, it } from "vitest";
import { decideAiTitleApply } from "../ai-title-apply";

describe("decideAiTitleApply", () => {
	const base = {
		labelAtStart: "Fix the scroll jitter when streaming",
		currentLabel: "Fix the scroll jitter when streaming" as string | null,
		title: "Fix scroll jitter" as string | null,
		otherLabels: [] as string[],
	};

	it("applies the title when nothing changed", () => {
		expect(decideAiTitleApply(base)).toEqual({
			kind: "apply",
			label: "Fix scroll jitter",
		});
	});

	it("skips when the user renamed the tab while the request ran", () => {
		expect(
			decideAiTitleApply({ ...base, currentLabel: "My own name" }),
		).toEqual({ kind: "skip", reason: "user-renamed" });
	});

	it("skips when the tab closed meanwhile", () => {
		expect(decideAiTitleApply({ ...base, currentLabel: null })).toEqual({
			kind: "skip",
			reason: "tab-closed",
		});
	});

	it("reports no-title when the agent gave nothing usable", () => {
		expect(decideAiTitleApply({ ...base, title: null })).toEqual({
			kind: "skip",
			reason: "no-title",
		});
	});

	it("suffixes on collision with another open tab", () => {
		expect(
			decideAiTitleApply({ ...base, otherLabels: ["Fix scroll jitter"] }),
		).toEqual({ kind: "apply", label: "Fix scroll jitter (2)" });
	});

	it("reports unchanged when the title equals the current label", () => {
		expect(
			decideAiTitleApply({
				...base,
				labelAtStart: "Fix scroll jitter",
				currentLabel: "Fix scroll jitter",
			}),
		).toEqual({ kind: "skip", reason: "unchanged" });
	});
});

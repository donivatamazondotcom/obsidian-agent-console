/**
 * I209 — the released tab's marker: a quiet dotted ring with a plain-language
 * label (spec § 4 "Marker"). Other states keep their unlabeled glyphs.
 *
 * Seam: the exported `TabStateIcon` the tab strip renders (R2). Assertions on
 * the Lucide icon passed to `setIcon` (I238), class and accessible label (R3).
 * Literals (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setIcon } from "obsidian";
import { cleanup, render } from "@testing-library/react";
import { TabStateIcon } from "../TabBar";

afterEach(cleanup);
beforeEach(() => vi.mocked(setIcon).mockClear());

describe("I209 TabStateIcon", () => {
	it("released shows the pause icon with the paused label", () => {
		const { container } = render(<TabStateIcon state="released" />);
		const el = container.querySelector("span")!;
		expect(setIcon).toHaveBeenCalledWith(el, "circle-pause");
		expect(el.className).toContain("agent-client-tab-state-released");
		expect(el.getAttribute("aria-label")).toBe(
			"Paused to save memory. Picks up when you type.",
		);
	});

	it("other states carry no label", () => {
		const { container } = render(<TabStateIcon state="disconnected" />);
		const el = container.querySelector("span")!;
		expect(setIcon).toHaveBeenCalledWith(el, "circle");
		expect(el.getAttribute("aria-label")).toBeNull();
	});
});

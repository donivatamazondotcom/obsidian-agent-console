/**
 * I209 — the released tab's marker: a quiet dotted ring with a plain-language
 * label (spec § 4 "Marker"). Tab Attention States gives every other state a
 * hover label too.
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
	it("released shows the moon icon with the asleep label", () => {
		const { container } = render(<TabStateIcon state="released" />);
		const el = container.querySelector("span")!;
		expect(setIcon).toHaveBeenCalledWith(el, "moon");
		expect(el.className).toContain("agent-client-tab-state-released");
		expect(el.getAttribute("aria-label")).toBe(
			"Asleep to save memory. Wakes up when you type.",
		);
	});

	// Tab Attention States: every state now explains itself on hover.
	it.each([
		["ready", "circle-dot", "Ready"],
		["busy", "loader-circle", "Working"],
		["permission", "triangle-alert", "Needs your approval"],
		["error", "circle-x", "Something went wrong"],
		["connecting", "circle-dashed", "Connecting…"],
		["disconnected", "circle", "Not connected"],
		["doneUnseen", "check", "Finished – you haven't looked yet"],
		["stoppedUnseen", "circle-alert", "Stopped early – you haven't looked yet"],
	] as const)("%s shows %s with label %s", (state, icon, label) => {
		const { container } = render(<TabStateIcon state={state} />);
		const el = container.querySelector("span")!;
		expect(setIcon).toHaveBeenCalledWith(el, icon);
		expect(el.className).toContain(`agent-client-tab-state-${state}`);
		expect(el.getAttribute("aria-label")).toBe(label);
	});
});

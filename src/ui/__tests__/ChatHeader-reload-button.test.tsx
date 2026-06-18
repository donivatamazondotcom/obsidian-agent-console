/**
 * T5 — header Reload button routing. Plain click → soft reload (`onReload(false)`);
 * Shift-click → hard reload (`onReload(true)`). Spec: `Agent Console Reload Control`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import * as React from "react";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";

// ChatHeader's NavActionButton + BrandedTitle use setIcon / ResizeObserver.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
}));

function segments(): HeaderSegments {
	return {
		plugin: "Agent Console",
		profile: "Test Agent",
		runtime: null,
		model: null,
	};
}

describe("ChatHeader reload button (T5)", () => {
	it("routes plain click to soft reload and Shift-click to hard reload", () => {
		const onReload = vi.fn();
		const { container } = render(
			<ChatHeader
				agentLabel="Test Agent"
				headerSegments={segments()}
				isUpdateAvailable={false}
				onReload={onReload}
				onExportChat={vi.fn()}
				onShowMenu={vi.fn()}
			/>,
		);

		const btn = container.querySelector(
			'[aria-label^="Reload session"]',
		) as HTMLElement | null;
		expect(btn).toBeTruthy();

		fireEvent.click(btn!);
		expect(onReload).toHaveBeenLastCalledWith(false);

		fireEvent.click(btn!, { shiftKey: true });
		expect(onReload).toHaveBeenLastCalledWith(true);

		expect(onReload).toHaveBeenCalledTimes(2);
	});
});

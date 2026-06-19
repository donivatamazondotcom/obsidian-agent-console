/**
 * T01–T03 — "Plugin update available!" pill is a real, clickable control that
 * hands off to Obsidian's Community-plugins updater. Spec: `Agent Console
 * Update Pill Click-Through`.
 *
 * T01: clicking the pill fires onUpdateClick exactly once.
 * T02: the pill is a native <button> (so Enter/Space activate it for free) and
 *      is focusable — guards against a regression back to a <span>.
 * T03: no pill in the DOM when isUpdateAvailable is false.
 *
 * The ChatPanel-level "open() then openTabById('community-plugins')" ordering
 * is a 3-line mirror of the already-shipped handleOpenSettings handler and the
 * "community-plugins" tab id was verified empirically against the running
 * Obsidian (app.setting.settingTabs); it is not re-asserted via a full-panel
 * render here. T01 proves ChatHeader invokes the wired callback.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import * as React from "react";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";

// ChatHeader's NavActionButton + BrandedTitle use setIcon / ResizeObserver;
// UpdatePill uses setTooltip.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
}));

function segments(): HeaderSegments {
	return {
		plugin: "Agent Console",
		profile: "Test Agent",
		runtime: null,
		model: null,
	};
}

function renderHeader(
	isUpdateAvailable: boolean,
	onUpdateClick: () => void = vi.fn(),
) {
	return render(
		<ChatHeader
			agentLabel="Test Agent"
			headerSegments={segments()}
			isUpdateAvailable={isUpdateAvailable}
			onUpdateClick={onUpdateClick}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
		/>,
	);
}

const PILL = ".agent-client-chat-view-header-update";

describe("Update pill click-through", () => {
	it("T01: clicking the pill fires onUpdateClick exactly once", () => {
		const onUpdateClick = vi.fn();
		const { container } = renderHeader(true, onUpdateClick);

		const pill = container.querySelector(PILL) as HTMLElement | null;
		expect(pill).toBeTruthy();

		fireEvent.click(pill!);
		expect(onUpdateClick).toHaveBeenCalledTimes(1);
	});

	it("T02: the pill is a native, focusable <button>", () => {
		const { container } = renderHeader(true);

		const pill = container.querySelector(PILL) as HTMLElement | null;
		expect(pill).toBeTruthy();
		// A real <button> (not a <span role="button">) gives Enter/Space
		// activation and focusability natively — the whole point of T02.
		expect(pill!.tagName).toBe("BUTTON");
		expect((pill as HTMLButtonElement).disabled).toBe(false);

		pill!.focus();
		expect(pill!.ownerDocument.activeElement).toBe(pill);
	});

	it("T03: no pill in the DOM when no update is available", () => {
		const onUpdateClick = vi.fn();
		const { container } = renderHeader(false, onUpdateClick);

		expect(container.querySelector(PILL)).toBeNull();
		expect(onUpdateClick).not.toHaveBeenCalled();
	});
});

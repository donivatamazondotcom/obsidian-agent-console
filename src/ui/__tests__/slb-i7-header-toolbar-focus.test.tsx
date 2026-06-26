/**
 * SLB-I7 — header action buttons form a single WAI-ARIA toolbar group with a
 * roving tabindex, so keyboard traversal across the header row is consistent.
 *
 * Spec: [[Shared Links Bubble]] § Known Issues SLB-I7.
 * Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
 *
 * Verifies:
 *   - the nav row is a role="toolbar" with an accessible name
 *   - exactly one enabled control holds the tab stop (tabindex 0); the rest -1
 *   - Left/Right arrows rove focus (wrapping); Home/End jump to ends
 *   - a disabled control (shared-links at zero links) is skipped and never holds
 *     the tab stop
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import * as React from "react";
import { ChatHeader, type HeaderSegments } from "../ChatHeader";
import type { SharedLink } from "../../utils/link-extract";

// BrandedTitle uses ResizeObserver; the header + SharedLinksButton use obsidian.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	// SharedLinksButton imports Menu but only instantiates it on click, which
	// these focus tests never do.
	Menu: class {},
}));
vi.mock("../../utils/menu-registry", () => ({ registerOpenMenu: vi.fn() }));

function segments(): HeaderSegments {
	return {
		plugin: "Agent Console",
		profile: "Test Agent",
		runtime: null,
		model: null,
	};
}

function link(label: string): SharedLink {
	return {
		key: `internal:${label}`,
		kind: "internal",
		label,
		target: label,
		isNew: false,
		order: 0,
	};
}

function renderHeader(opts: { links?: SharedLink[]; withShared?: boolean }) {
	return render(
		<ChatHeader
			agentLabel="Test Agent"
			headerSegments={segments()}
			isUpdateAvailable={false}
			onUpdateClick={vi.fn()}
			onReload={vi.fn()}
			onExportChat={vi.fn()}
			onShowMenu={vi.fn()}
			onOpenHistory={vi.fn()}
			sharedLinks={opts.links}
			onOpenSharedLink={opts.withShared === false ? undefined : vi.fn()}
		/>,
	);
}

function items(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>("[data-acp-toolbar-item]"),
	);
}
const tab = (el: HTMLElement) => el.getAttribute("tabindex");

describe("SLB-I7 header toolbar roving focus", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("renders a labelled role=toolbar around the action buttons", () => {
		const { container } = renderHeader({ links: [link("A"), link("B")] });
		const toolbar = container.querySelector('[role="toolbar"]');
		expect(toolbar).toBeTruthy();
		expect(toolbar?.getAttribute("aria-label")).toBe("Chat actions");
		// shared-links + reload + history + save + more
		expect(items(container)).toHaveLength(5);
	});

	it("gives exactly one enabled control the tab stop; the rest are -1", () => {
		const { container } = renderHeader({ links: [link("A"), link("B")] });
		const els = items(container);
		const zeros = els.filter((e) => tab(e) === "0");
		expect(zeros).toHaveLength(1);
		// First control (shared-links, enabled) holds the tab stop.
		expect(zeros[0].classList.contains("acp-shared-links-button")).toBe(
			true,
		);
		expect(els.filter((e) => tab(e) === "-1")).toHaveLength(4);
	});

	it("ArrowRight/ArrowLeft rove focus and the tab stop, wrapping at the ends", () => {
		const { container } = renderHeader({ links: [link("A")] });
		const els = items(container);
		const [shared, reload] = els;
		const last = els[els.length - 1];

		shared.focus();
		fireEvent.keyDown(shared, { key: "ArrowRight" });
		expect(document.activeElement).toBe(reload);
		expect(tab(reload)).toBe("0");
		expect(tab(shared)).toBe("-1");

		// ArrowLeft from the first control wraps to the last.
		shared.focus();
		fireEvent.keyDown(shared, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(last);
		expect(tab(last)).toBe("0");
	});

	it("Home and End jump to the first and last controls", () => {
		const { container } = renderHeader({ links: [link("A")] });
		const els = items(container);
		const first = els[0];
		const last = els[els.length - 1];

		first.focus();
		fireEvent.keyDown(first, { key: "End" });
		expect(document.activeElement).toBe(last);

		fireEvent.keyDown(last, { key: "Home" });
		expect(document.activeElement).toBe(first);
	});

	it("skips the disabled shared-links button (zero links) and never gives it the tab stop", () => {
		const { container } = renderHeader({ links: [] });
		const els = items(container);
		const shared = els[0];
		const reload = els[1];

		// Disabled shared-links button is present but excluded from the tab order.
		expect(shared.classList.contains("acp-shared-links-button")).toBe(true);
		expect(shared.getAttribute("aria-disabled")).toBe("true");
		expect(tab(shared)).toBe("-1");
		// First *enabled* control (reload) holds the tab stop.
		expect(tab(reload)).toBe("0");

		// Arrow navigation skips the disabled control.
		reload.focus();
		fireEvent.keyDown(reload, { key: "ArrowLeft" });
		expect(document.activeElement).not.toBe(shared);
		expect(document.activeElement).toBe(els[els.length - 1]);
	});
});

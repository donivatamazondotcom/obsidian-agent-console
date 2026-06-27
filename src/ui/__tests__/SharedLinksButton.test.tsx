/**
 * SharedLinksButton — header indicator for the Shared Links Bubble.
 *
 * Covers spec [[Shared Links Bubble]] § Test Cases:
 *   T5  zero links -> button visible but greyed/disabled, no badge, no menu
 *   badge shows the unique-link count; accent class only when >=1 new link
 *   click builds a grouped Menu (New this session / Earlier) and a link item
 *   routes through onOpenLink (T6 open-through).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import * as React from "react";

// Recorders shared with the hoisted obsidian mock.
const h = vi.hoisted(() => {
	interface FakeItem {
		title?: string;
		isLabel?: boolean;
		separator?: boolean;
		click?: (e: unknown) => void;
	}
	const menus: Array<{ items: FakeItem[]; shown: boolean; via: string | null }> = [];
	return { menus };
});

vi.mock("obsidian", () => {
	class Menu {
		items: Array<{
			title?: string;
			isLabel?: boolean;
			separator?: boolean;
			click?: (e: unknown) => void;
		}> = [];
		_record = { items: this.items, shown: false, via: null as string | null };
		constructor() {
			h.menus.push(this._record);
		}
		addItem(cb: (item: unknown) => void) {
			const item: {
				title?: string;
				isLabel?: boolean;
				click?: (e: unknown) => void;
			} = {};
			const api = {
				setTitle(t: string) {
					item.title = t;
					return api;
				},
				setIcon() {
					return api;
				},
				setIsLabel(v: boolean) {
					item.isLabel = v;
					return api;
				},
				onClick(fn: (e: unknown) => void) {
					item.click = fn;
					return api;
				},
			};
			cb(api);
			this.items.push(item);
			return this;
		}
		addSeparator() {
			this.items.push({ separator: true });
			return this;
		}
		showAtMouseEvent() {
			this._record.shown = true;
			this._record.via = "mouse";
		}
		showAtPosition() {
			this._record.shown = true;
			this._record.via = "position";
		}
		onHide() {}
	}
	return { Menu, setIcon: vi.fn() };
});

// Keep the real showMenuAtEvent (so button → helper → menu positioning runs
// end-to-end and the SLB-I7 anchoring assertions still exercise live wiring);
// only registerOpenMenu is stubbed.
vi.mock("../../utils/menu-registry", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../utils/menu-registry")>();
	return { ...actual, registerOpenMenu: vi.fn() };
});

import { SharedLinksButton } from "../SharedLinksButton";
import type { SharedLink } from "../../utils/link-extract";

function link(partial: Partial<SharedLink>): SharedLink {
	return {
		key: partial.key ?? `internal:${partial.target ?? "x"}`,
		kind: partial.kind ?? "internal",
		label: partial.label ?? "X",
		target: partial.target ?? "X",
		isNew: partial.isNew ?? false,
		order: partial.order ?? 0,
	};
}

beforeEach(() => {
	h.menus.length = 0;
});

describe("SharedLinksButton", () => {
	it("T5: greyed/disabled with no badge when there are zero links", () => {
		const onOpenLink = vi.fn();
		const { container } = render(
			<SharedLinksButton links={[]} onOpenLink={onOpenLink} />,
		);
		const btn = container.querySelector(
			".acp-shared-links-button",
		) as HTMLElement;
		expect(btn).toBeTruthy();
		expect(
			btn.classList.contains("acp-shared-links-button--disabled"),
		).toBe(true);
		expect((btn as HTMLButtonElement).disabled).toBe(true);
		expect(container.querySelector(".acp-shared-links-badge")).toBeNull();

		fireEvent.click(btn);
		expect(h.menus).toHaveLength(0);
		expect(onOpenLink).not.toHaveBeenCalled();
	});

	it("shows the unique-link count in the badge; accent only when a link is new", () => {
		const plain = render(
			<SharedLinksButton
				links={[link({ label: "A" }), link({ label: "B", target: "B" })]}
				onOpenLink={vi.fn()}
			/>,
		);
		const badge = plain.container.querySelector(
			".acp-shared-links-badge",
		) as HTMLElement;
		expect(badge.textContent).toBe("2");
		expect(badge.classList.contains("acp-shared-links-badge--accent")).toBe(
			false,
		);

		const withNew = render(
			<SharedLinksButton
				links={[link({ label: "A", isNew: true })]}
				onOpenLink={vi.fn()}
			/>,
		);
		const accentBadge = withNew.container.querySelector(
			".acp-shared-links-badge",
		) as HTMLElement;
		expect(
			accentBadge.classList.contains("acp-shared-links-badge--accent"),
		).toBe(true);
	});

	it("opens a grouped menu and routes a link click through onOpenLink (T6)", () => {
		const onOpenLink = vi.fn();
		const newLink = link({ label: "Created.md", isNew: true, target: "Created.md" });
		const oldLink = link({ label: "Old.md", target: "Old.md" });
		const { container } = render(
			<SharedLinksButton
				links={[newLink, oldLink]}
				onOpenLink={onOpenLink}
			/>,
		);
		fireEvent.click(
			container.querySelector(".acp-shared-links-button") as HTMLElement,
		);

		expect(h.menus).toHaveLength(1);
		const menu = h.menus[0];
		expect(menu.shown).toBe(true);
		// No section labels — a bare separator divides new (top) from old.
		expect(menu.items.filter((i) => i.isLabel)).toHaveLength(0);
		expect(
			menu.items.map((i) => (i.separator ? "---" : i.title)),
		).toEqual(["Created.md", "---", "Old.md"]);

		// Click the "Created.md" item -> onOpenLink fired with that link.
		const item = menu.items.find((i) => i.title === "Created.md");
		item?.click?.(new MouseEvent("click"));
		expect(onOpenLink).toHaveBeenCalledTimes(1);
		expect(onOpenLink.mock.calls[0][0]).toMatchObject({ label: "Created.md" });
	});

	it("renders a flat list with no separator or labels when nothing is new", () => {
		const { container } = render(
			<SharedLinksButton
				links={[
					link({ label: "A", target: "A" }),
					link({ label: "B", target: "B" }),
				]}
				onOpenLink={vi.fn()}
			/>,
		);
		fireEvent.click(
			container.querySelector(".acp-shared-links-button") as HTMLElement,
		);
		const menu = h.menus[0];
		expect(menu.items.some((i) => i.separator)).toBe(false);
		expect(menu.items.filter((i) => i.isLabel)).toHaveLength(0);
		expect(menu.items.map((i) => i.title)).toEqual(["A", "B"]);
	});

	it("SLB-I7: renders a native button so it is individually focusable", () => {
		const { container } = render(
			<SharedLinksButton
				links={[link({ label: "A" })]}
				onOpenLink={vi.fn()}
			/>,
		);
		const btn = container.querySelector(
			".acp-shared-links-button",
		) as HTMLButtonElement;
		// A native <button> (not a div[role=button]) is individually tab-focusable
		// and inherits Obsidian's clickable-icon focus ring, like its siblings.
		expect(btn.tagName).toBe("BUTTON");
		expect(btn.disabled).toBe(false);
	});

	it("SLB-I7: keyboard activation anchors the menu by position; mouse uses the cursor", () => {
		const { container } = render(
			<SharedLinksButton
				links={[link({ label: "A" })]}
				onOpenLink={vi.fn()}
			/>,
		);
		const btn = container.querySelector(
			".acp-shared-links-button",
		) as HTMLButtonElement;

		// Enter/Space on a native button produce a click with detail === 0.
		fireEvent.click(btn, { detail: 0 });
		expect(h.menus[0].shown).toBe(true);
		expect(h.menus[0].via).toBe("position");

		// A real mouse click carries detail >= 1.
		fireEvent.click(btn, { detail: 1 });
		expect(h.menus[1].via).toBe("mouse");
	});
});

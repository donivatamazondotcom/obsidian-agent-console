/**
 * SuggestionPopup — unified picker control (Tier 1).
 *
 * The popup renders a domain-agnostic list of `PickerItem` rows plus an optional
 * pinned `PickerInstruction` footer. Each caller (mention `@`, slash `/`,
 * quick-prompt `!`) supplies its own items + instructions; this suite exercises
 * the shared rendering contract. Spec: [[Unified Picker Control]].
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SuggestionPopup } from "../SuggestionPopup";
import type { PickerItem, PickerInstruction } from "../../types/picker";

// jsdom does not implement scrollIntoView, which SuggestionPopup calls on mount.
if (!HTMLElement.prototype.scrollIntoView) {
	HTMLElement.prototype.scrollIntoView = vi.fn();
}

afterEach(cleanup);

function pi(over: Partial<PickerItem>): PickerItem {
	return { id: "x", title: "X", ...over };
}

const NAV: PickerInstruction[] = [
	{ keys: "↑↓", label: "navigate" },
	{ keys: "↵", label: "add to context" },
	{ keys: "esc", label: "dismiss" },
];

describe("SuggestionPopup — rows", () => {
	it("renders one row per item", () => {
		render(
			<SuggestionPopup
				items={[
					pi({ id: "a", title: "Daily brief" }),
					pi({ id: "b", title: "Summarize" }),
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("Daily brief")).toBeTruthy();
		expect(screen.getByText("Summarize")).toBeTruthy();
	});

	it("renders the subtitle when present and omits it otherwise", () => {
		const { container } = render(
			<SuggestionPopup
				items={[
					pi({ id: "a", title: "Note A", subtitle: "folder/Note A.md" }),
					pi({ id: "b", title: "Note B" }),
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("folder/Note A.md")).toBeTruthy();
		expect(
			container.querySelectorAll(".agent-client-mention-dropdown-item-path")
				.length,
		).toBe(1);
	});

	it("applies the layout class per item (inline vs stacked)", () => {
		const { container } = render(
			<SuggestionPopup
				items={[
					pi({ id: "a", title: "A", layout: "inline" }),
					pi({ id: "b", title: "B", layout: "stacked" }),
					pi({ id: "c", title: "C" }), // default → stacked
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(
			container.querySelectorAll(".agent-client-picker-item-inline").length,
		).toBe(1);
		expect(
			container.querySelectorAll(".agent-client-picker-item-stacked").length,
		).toBe(2);
	});

	it("renders inline markers with accessible labels", () => {
		const { container } = render(
			<SuggestionPopup
				items={[
					pi({
						id: "nt",
						title: "New tab one",
						markers: [{ glyph: "↗", label: "opens in a new tab" }],
					}),
					pi({
						id: "sel",
						title: "Sel one",
						markers: [
							{ glyph: "{ }", label: "uses your selected text" },
						],
					}),
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const markers = container.querySelectorAll(
			".agent-client-quick-prompt-row-marker",
		);
		expect(markers.length).toBe(2);
		expect(
			container.querySelector('[aria-label="opens in a new tab"]'),
		).toBeTruthy();
	});

	it("returns null when there are no items and no create row", () => {
		const { container } = render(
			<SuggestionPopup
				items={[]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});

describe("SuggestionPopup — selection", () => {
	it("reports the row index and forwards the DOM event on click", () => {
		const onSelect = vi.fn();
		render(
			<SuggestionPopup
				items={[
					pi({ id: "a", title: "First" }),
					pi({ id: "b", title: "Second" }),
				]}
				selectedIndex={0}
				onSelect={onSelect}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("Second"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0][0]).toBe(1);
		// Event forwarded so callers can read modifier keys (2×2 gesture).
		expect(onSelect.mock.calls[0][1]).toBeTruthy();
	});
});

describe("SuggestionPopup — instruction footer", () => {
	it("renders the pinned footer OUTSIDE the scrollable rows container", () => {
		const { container } = render(
			<SuggestionPopup
				items={[pi({ id: "a", title: "First" })]}
				instructions={NAV}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const scroll = container.querySelector(
			".agent-client-mention-dropdown-scroll",
		);
		const footer = container.querySelector(
			".agent-client-mention-dropdown-instructions",
		);
		expect(scroll).toBeTruthy();
		expect(footer).toBeTruthy();
		// Footer must not scroll out of view / force an always-on scrollbar.
		expect(scroll?.contains(footer)).toBe(false);
		expect(screen.getByText(/navigate/)).toBeTruthy();
		expect(screen.getByText(/add to context/)).toBeTruthy();
		expect(screen.getByText(/dismiss/)).toBeTruthy();
	});

	it("renders no footer when instructions are omitted", () => {
		const { container } = render(
			<SuggestionPopup
				items={[pi({ id: "a", title: "First" })]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(
			container.querySelector(
				".agent-client-mention-dropdown-instructions",
			),
		).toBeNull();
	});

	it("renders no inter-row separators (harmonized with the native picker)", () => {
		const { container } = render(
			<SuggestionPopup
				items={[
					pi({ id: "a", title: "One" }),
					pi({ id: "b", title: "Two" }),
					pi({ id: "c", title: "Three" }),
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(
			container.querySelectorAll(".agent-client-has-border").length,
		).toBe(0);
	});
});

describe("SuggestionPopup — create row", () => {
	const createRow = { label: 'Create quick prompt "daily"' };

	it("renders the create row when items are empty", () => {
		render(
			<SuggestionPopup
				items={[]}
				selectedIndex={0}
				createRow={createRow}
				onCreate={vi.fn()}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText('Create quick prompt "daily"')).toBeTruthy();
	});

	it("invokes onCreate when the create row is clicked", () => {
		const onCreate = vi.fn();
		render(
			<SuggestionPopup
				items={[]}
				selectedIndex={0}
				createRow={createRow}
				onCreate={onCreate}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText('Create quick prompt "daily"'));
		expect(onCreate).toHaveBeenCalledTimes(1);
	});

	it("marks the create row selected when selectedIndex === items.length", () => {
		const { container } = render(
			<SuggestionPopup
				items={[pi({ id: "a", title: "Daily brief" })]}
				selectedIndex={1}
				createRow={createRow}
				onCreate={vi.fn()}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const row = container.querySelector(
			".agent-client-quick-prompt-create-row",
		);
		expect(row?.classList.contains("agent-client-selected")).toBe(true);
	});
});

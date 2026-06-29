/**
 * SuggestionPopup — quick-prompt dropdown type (S3-T4, render + wiring half).
 *
 * The composer `!` trigger renders a quick-prompt dropdown: one row per ranked
 * prompt (with ↗ new-tab / { } selection markers), a modifier-legend footer,
 * and onSelect that forwards the DOM event so the consumer can map ⌘/⌘⇧/⌥ to
 * the 2×2 gesture. See [[Agent Console Quick Prompts UX Refinement]] slice 3.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SuggestionPopup } from "../SuggestionPopup";
import type { QuickPrompt } from "../../types/quick-prompt";

// jsdom does not implement scrollIntoView, which SuggestionPopup calls on mount.
if (!HTMLElement.prototype.scrollIntoView) {
	HTMLElement.prototype.scrollIntoView = vi.fn();
}

afterEach(cleanup);

function qp(over: Partial<QuickPrompt>): QuickPrompt {
	return {
		id: "x",
		label: "X",
		body: "b",
		path: "Quick Prompts/x.md",
		usesSelection: false,
		...over,
	};
}

describe("SuggestionPopup — quick-prompt type (S3-T4)", () => {
	it("renders a row per prompt plus the modifier-legend footer", () => {
		render(
			<SuggestionPopup
				type="quick-prompt"
				items={[
					qp({ id: "a", label: "Daily brief" }),
					qp({ id: "b", label: "Summarize" }),
				]}
				selectedIndex={0}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("Daily brief")).toBeTruthy();
		expect(screen.getByText("Summarize")).toBeTruthy();
		// Legend footer (plain-language modifier hints).
		expect(screen.getByText(/run/)).toBeTruthy();
		expect(screen.getByText(/new tab/)).toBeTruthy();
		expect(screen.getByText(/switch/)).toBeTruthy();
		expect(screen.getByText(/insert/)).toBeTruthy();
	});

	it("forwards the click event to onSelect (enables the 2×2 gesture)", () => {
		const onSelect = vi.fn();
		render(
			<SuggestionPopup
				type="quick-prompt"
				items={[qp({ id: "a", label: "Daily brief" })]}
				selectedIndex={0}
				onSelect={onSelect}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("Daily brief"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		// Second arg is the DOM event — without it the modifier gesture is lost.
		expect(onSelect.mock.calls[0][1]).toBeTruthy();
	});

	it("marks new-tab (↗) and selection ({ }) prompts with row markers", () => {
		const { container } = render(
			<SuggestionPopup
				type="quick-prompt"
				items={[
					qp({ id: "nt", label: "New tab one", newTab: true }),
					qp({ id: "sel", label: "Sel one", usesSelection: true }),
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
	});
});

describe("SuggestionPopup — quick-prompt create-on-no-match row (S4-T9)", () => {
	const createRow = {
		kind: "create-prompt" as const,
		query: "daily",
		label: 'Create quick prompt "daily"',
	};

	it("renders the create row when items are empty (zero-match / zero-prompt)", () => {
		render(
			<SuggestionPopup
				type="quick-prompt"
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

	it("returns null when there are no items AND no create row", () => {
		const { container } = render(
			<SuggestionPopup
				type="quick-prompt"
				items={[]}
				selectedIndex={0}
				createRow={null}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("clicking the create row invokes onCreate", () => {
		const onCreate = vi.fn();
		render(
			<SuggestionPopup
				type="quick-prompt"
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
				type="quick-prompt"
				items={[qp({ id: "a", label: "Daily brief" })]}
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

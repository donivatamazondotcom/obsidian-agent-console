/**
 * QuickPromptBar (T21 + slice-1 2×2).
 *
 * Empty matched set ⇒ no row. Otherwise a chip per prompt; `newTab` chips show
 * the ↗ (external-link) marker — NOT a return glyph, which would read as Enter.
 * Click fires the 2×2 gesture (⌘ new tab · ⇧ foreground · ⌥ insert). While
 * queued, current-tab chips are disabled in place (aria-disabled, no-op) while
 * `newTab` chips stay live.
 *
 * See [[Agent Console Quick Prompts UX Refinement]] § The action model.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { setIcon } from "obsidian";
import {
	QuickPromptBar,
	newTabChipTooltip,
	thisTabChipTooltip,
} from "../QuickPromptBar";
import type { QuickPrompt } from "../../types/quick-prompt";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const PLAIN = { openElsewhere: false, foreground: false, insert: false };

function p(overrides: Partial<QuickPrompt>): QuickPrompt {
	return {
		id: "id",
		label: "Label",
		body: "b",
		path: "Quick Prompts/x.md",
		usesSelection: false,
		...overrides,
	};
}

describe("QuickPromptBar — T21", () => {
	it("renders nothing when there are no matching prompts (no row)", () => {
		const { container } = render(
			<QuickPromptBar prompts={[]} hasPendingQueue={false} onFire={vi.fn()} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders a chip per prompt; newTab chips get the ↗ (external-link) marker, not ↩", () => {
		const { container } = render(
			<QuickPromptBar
				prompts={[
					p({ id: "daily", label: "Daily brief", newTab: true }),
					p({ id: "sync", label: "Sync opps" }),
				]}
				hasPendingQueue={false}
				onFire={vi.fn()}
			/>,
		);
		expect(screen.getByText("Daily brief")).toBeTruthy();
		expect(screen.getByText("Sync opps")).toBeTruthy();
		// newTab marker span present once, rendered via setIcon("external-link")
		// — never a literal ↩ (which reads as Enter, colliding with the picker).
		expect(
			container.querySelectorAll(".agent-client-quick-prompt-chip-newtab"),
		).toHaveLength(1);
		expect(screen.queryByText("↩")).toBeNull();
		expect(setIcon).toHaveBeenCalledWith(expect.anything(), "external-link");
		// Guidance tooltip lives in aria-label — Obsidian's themed tooltip
		// mechanism (not the native `title`). new-tab vs this-tab matrix.
		expect(
			screen.getByText("Daily brief").closest("button")!.getAttribute("aria-label"),
		).toBe(newTabChipTooltip());
		expect(
			screen.getByText("Sync opps").closest("button")!.getAttribute("aria-label"),
		).toBe(thisTabChipTooltip());
	});

	it("fires the plain gesture on click; ⌥-click sets insert", () => {
		const onFire = vi.fn();
		const prompt = p({ id: "sync", label: "Sync opps" });
		render(
			<QuickPromptBar prompts={[prompt]} hasPendingQueue={false} onFire={onFire} />,
		);
		const chip = screen.getByText("Sync opps").closest("button")!;
		fireEvent.click(chip);
		expect(onFire).toHaveBeenLastCalledWith(prompt, PLAIN);
		fireEvent.click(chip, { altKey: true });
		expect(onFire).toHaveBeenLastCalledWith(prompt, { ...PLAIN, insert: true });
	});

	it("while queued: current-tab chip is aria-disabled and does not fire; newTab chip stays live", () => {
		const onFire = vi.fn();
		const current = p({ id: "sync", label: "Sync opps" });
		const newTab = p({ id: "daily", label: "Daily brief", newTab: true });
		render(
			<QuickPromptBar
				prompts={[current, newTab]}
				hasPendingQueue={true}
				onFire={onFire}
			/>,
		);
		const currentChip = screen.getByText("Sync opps").closest("button")!;
		expect(currentChip.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(currentChip);
		expect(onFire).not.toHaveBeenCalledWith(current, expect.anything());

		const newTabChip = screen.getByText("Daily brief").closest("button")!;
		expect(newTabChip.getAttribute("aria-disabled")).toBe("false");
		fireEvent.click(newTabChip);
		expect(onFire).toHaveBeenCalledWith(newTab, PLAIN);
	});
});

describe("QuickPromptBar — S5-T4 (chip context menu)", () => {
	it("right-click (contextmenu) a chip fires onChipContextMenu with the prompt", () => {
		const onChipContextMenu = vi.fn();
		const prompt = p({ id: "sync", label: "Sync opps" });
		render(
			<QuickPromptBar
				prompts={[prompt]}
				hasPendingQueue={false}
				onFire={vi.fn()}
				onChipContextMenu={onChipContextMenu}
			/>,
		);
		const chip = screen.getByText("Sync opps").closest("button")!;
		fireEvent.contextMenu(chip);
		expect(onChipContextMenu).toHaveBeenCalledTimes(1);
		expect(onChipContextMenu.mock.calls[0][0]).toBe(prompt);
	});

	// Keyboard parity is free: the context-menu key / Shift+F10 dispatches a
	// native `contextmenu` event on the focused chip, which React routes to the
	// same onContextMenu handler (jsdom can't synthesize the key → covered in
	// the human smoke test).

	it("context menu works even while the chip is queue-disabled (managing ≠ firing)", () => {
		const onChipContextMenu = vi.fn();
		const prompt = p({ id: "sync", label: "Sync opps" });
		render(
			<QuickPromptBar
				prompts={[prompt]}
				hasPendingQueue={true}
				onFire={vi.fn()}
				onChipContextMenu={onChipContextMenu}
			/>,
		);
		const chip = screen.getByText("Sync opps").closest("button")!;
		fireEvent.contextMenu(chip);
		expect(onChipContextMenu).toHaveBeenCalledTimes(1);
	});

	it("left-click still fires the 2×2 gesture (regression), not the context menu", () => {
		const onChipContextMenu = vi.fn();
		const onFire = vi.fn();
		const prompt = p({ id: "sync", label: "Sync opps" });
		render(
			<QuickPromptBar
				prompts={[prompt]}
				hasPendingQueue={false}
				onFire={onFire}
				onChipContextMenu={onChipContextMenu}
			/>,
		);
		const chip = screen.getByText("Sync opps").closest("button")!;
		fireEvent.click(chip);
		expect(onFire).toHaveBeenCalledWith(prompt, PLAIN);
		expect(onChipContextMenu).not.toHaveBeenCalled();
	});
});

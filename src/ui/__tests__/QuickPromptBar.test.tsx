/**
 * QuickPromptBar (T21).
 *
 * Empty matched set ⇒ no row. Otherwise a chip per prompt; `newTab` chips show
 * the ↩ marker; click fires (⇧/⌥-click inserts). While queued, current-tab
 * chips are disabled in place (aria-disabled, no-op) while `newTab` chips stay
 * live.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Test Cases T21.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QuickPromptBar } from "../QuickPromptBar";
import type { QuickPrompt } from "../../types/quick-prompt";

afterEach(cleanup);

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

	it("renders a chip per prompt, labelled, with ↩ on newTab chips", () => {
		render(
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
		// newTab marker present once (on the Daily brief chip).
		expect(screen.getByText("↩")).toBeTruthy();
	});

	it("fires on click; ⌥-click inserts (modifier=true)", () => {
		const onFire = vi.fn();
		const prompt = p({ id: "sync", label: "Sync opps" });
		render(
			<QuickPromptBar prompts={[prompt]} hasPendingQueue={false} onFire={onFire} />,
		);
		const chip = screen.getByRole("button", { name: "Sync opps" });
		fireEvent.click(chip);
		expect(onFire).toHaveBeenLastCalledWith(prompt, { modifier: false });
		fireEvent.click(chip, { altKey: true });
		expect(onFire).toHaveBeenLastCalledWith(prompt, { modifier: true });
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
		expect(onFire).toHaveBeenCalledWith(newTab, { modifier: false });
	});
});

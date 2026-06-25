/**
 * InputToolbar — Quick prompts zap launcher (T22).
 *
 * The launcher renders when `onOpenQuickPrompts` is provided, opens the picker
 * on click, and stays reachable even when the send button is disabled (the
 * composer is locked/queued) — it's a plain button, not gated by send state.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Test Cases T22.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InputToolbar } from "../InputToolbar";

afterEach(cleanup);

function baseProps() {
	return {
		isSending: false,
		isButtonDisabled: false,
		hasContent: false,
		onSendOrStop: vi.fn(),
		isSessionReady: true,
	};
}

describe("InputToolbar — quick prompts launcher (T22)", () => {
	it("renders the zap launcher when onOpenQuickPrompts is provided", () => {
		render(
			<InputToolbar {...baseProps()} onOpenQuickPrompts={vi.fn()} />,
		);
		expect(screen.getByRole("button", { name: "Quick prompts" })).toBeTruthy();
	});

	it("does not render the launcher when onOpenQuickPrompts is absent", () => {
		render(<InputToolbar {...baseProps()} />);
		expect(screen.queryByRole("button", { name: "Quick prompts" })).toBeNull();
	});

	it("opens the picker on click", () => {
		const onOpen = vi.fn();
		render(<InputToolbar {...baseProps()} onOpenQuickPrompts={onOpen} />);
		fireEvent.click(screen.getByRole("button", { name: "Quick prompts" }));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("stays reachable while the composer is locked (send disabled)", () => {
		const onOpen = vi.fn();
		render(
			<InputToolbar
				{...baseProps()}
				isButtonDisabled={true}
				onOpenQuickPrompts={onOpen}
			/>,
		);
		const launcher = screen.getByRole("button", { name: "Quick prompts" });
		expect(launcher.hasAttribute("disabled")).toBe(false);
		fireEvent.click(launcher);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});

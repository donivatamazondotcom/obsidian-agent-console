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

/**
 * Layout split (I-spacer): the zap launcher must sit at the composer text-left
 * edge for EVERY agent, not only usage-reporting ones. The left/right split is
 * owned by an always-present flex spacer (`.agent-client-toolbar-spacer`), not
 * by the conditional usage indicator's auto-margin — so the launcher stays
 * left even when `usage` is absent.
 *
 * jsdom can't compute flexbox, so we assert the DOM structure that produces the
 * layout: spacer present, ordered after the launcher and before the send
 * button, with and without usage. See [[Agent Console Quick Prompts and
 * Workflows]] § Three surfaces (zap "leftmost") + § Screen mocks.
 */
describe("InputToolbar — launcher left-anchor split (spacer)", () => {
	/** True when `b` follows `a` in document order. */
	function follows(a: Element, b: Element): boolean {
		return Boolean(
			a.compareDocumentPosition(b) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		);
	}

	it("renders an always-present spacer between the launcher and send button (no usage)", () => {
		const { container } = render(
			<InputToolbar {...baseProps()} onOpenQuickPrompts={vi.fn()} />,
		);
		const launcher = container.querySelector(
			".agent-client-quick-prompt-launcher",
		)!;
		const spacer = container.querySelector(
			".agent-client-toolbar-spacer",
		)!;
		const send = container.querySelector(
			".agent-client-chat-send-button",
		)!;
		expect(launcher).toBeTruthy();
		expect(spacer).toBeTruthy();
		expect(send).toBeTruthy();
		// Left cluster (launcher) → spacer → right cluster (send).
		expect(follows(launcher, spacer)).toBe(true);
		expect(follows(spacer, send)).toBe(true);
	});

	it("keeps the usage % in the left cluster: launcher → usage → spacer → send", () => {
		const { container } = render(
			<InputToolbar
				{...baseProps()}
				onOpenQuickPrompts={vi.fn()}
				usage={{ used: 1234, size: 10000 }}
			/>,
		);
		const launcher = container.querySelector(
			".agent-client-quick-prompt-launcher",
		)!;
		const usage = container.querySelector(
			".agent-client-usage-indicator",
		)!;
		const spacer = container.querySelector(
			".agent-client-toolbar-spacer",
		)!;
		const send = container.querySelector(
			".agent-client-chat-send-button",
		)!;
		expect(usage).toBeTruthy();
		// Usage sits left of the spacer (left cluster), spacer owns the split.
		expect(follows(launcher, usage)).toBe(true);
		expect(follows(usage, spacer)).toBe(true);
		expect(follows(spacer, send)).toBe(true);
	});
});

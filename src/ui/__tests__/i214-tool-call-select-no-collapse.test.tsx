/**
 * I214: drag-selecting text in an expanded tool call's header collapses the
 * tool call (ported from upstream RAIT-09 b80e59e).
 *
 * A drag that starts and ends inside the header fires `click` on mouseup, and
 * the header's `onClick` toggled unconditionally, so the body the user was
 * about to copy from collapsed under them.
 *
 * Outcome asserted: aria-expanded on the rendered header. A plain click (no
 * selection, or a selection outside the header) still collapses, so the guard
 * is narrow. Keyboard Enter/Space is a separate path and is unaffected.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { ToolCallBlock } from "../ToolCallBlock";
import type { MessageContent } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";

vi.mock("obsidian", () => ({
	FileSystemAdapter: class {},
	Platform: { isMacOS: true, isWin: false, isLinux: false },
	setIcon: () => {},
}));

const plugin = {
	app: { vault: { adapter: {} } },
	settings: { displaySettings: { showEmojis: true } },
	mcpAuthManager: { getPending: () => [], onChange: () => () => {} },
} as unknown as AgentClientPlugin;

type ToolCall = Extract<MessageContent, { type: "tool_call" }>;

function renderExpanded() {
	const content = {
		type: "tool_call",
		toolCallId: "tc-1",
		title: "Read src/utils/toolCallDiff.ts",
		status: "completed",
		kind: "read",
	} as ToolCall;
	const view = render(
		<div>
			<p data-testid="outside">Some other transcript text</p>
			<ToolCallBlock content={content} plugin={plugin} />
		</div>,
	);
	// Tool calls render collapsed by default; expand via the summary row.
	const summary = view.container.querySelector(
		"button.agent-client-message-tool-call-summary",
	);
	fireEvent.click(summary!);
	const header = () =>
		view.container.querySelector(
			".agent-client-message-tool-call-header",
		) as HTMLElement | null;
	expect(header()?.getAttribute("aria-expanded")).toBe("true");
	return { view, header };
}

function select(node: Node) {
	const sel = document.getSelection()!;
	sel.removeAllRanges();
	sel.selectAllChildren(node);
	expect(sel.isCollapsed).toBe(false);
}

describe("I214: selecting text in a tool call header does not collapse it", () => {
	afterEach(() => {
		document.getSelection()?.removeAllRanges();
		cleanup();
	});

	it("stays expanded when the click completes a selection inside the header", () => {
		const { header } = renderExpanded();
		select(header()!);
		fireEvent.click(header()!);
		expect(header()?.getAttribute("aria-expanded")).toBe("true");
		document.getSelection()!.removeAllRanges();
	});

	it("still collapses on a plain click", () => {
		const { view, header } = renderExpanded();
		document.getSelection()!.removeAllRanges();
		fireEvent.click(header()!);
		expect(header()).toBeNull();
		expect(
			view.container
				.querySelector("button.agent-client-message-tool-call-summary")
				?.getAttribute("aria-expanded"),
		).toBe("false");
	});

	it("still collapses when the only selection is elsewhere in the transcript", () => {
		const { view, header } = renderExpanded();
		select(view.getByTestId("outside"));
		fireEvent.click(header()!);
		expect(header()).toBeNull();
		document.getSelection()!.removeAllRanges();
	});
});

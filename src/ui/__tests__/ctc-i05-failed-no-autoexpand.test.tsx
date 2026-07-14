/**
 * CTC-I05: Failed tool calls no longer auto-expand.
 *
 * Before: a failed tool call auto-expanded (I04 intent — "show why it failed
 * without a click"), but that landed on a body whose error surface was
 * inconsistent and made it hard to parse WHY a particular card was expanded.
 *
 * After: failed calls stay COLLAPSED. The collapsed summary row flags failure
 * with a highlighted status chip (the "x" icon on an error-background pill,
 * class `agent-client-status-failed`), so the user parses "this failed" at a
 * glance and chooses to expand. The error itself is surfaced by RawPayloadBlock
 * on manual expand. Only a pending permission still forces expansion, because
 * the user must see the PermissionBanner to act.
 *
 * Spec: [[CTC-I05-CompactToolCalls-Failed-No-Autoexpand-Highlight]]
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";

import { ToolCallBlock } from "../ToolCallBlock";
import type { MessageContent } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("obsidian", () => ({
	// instanceof check in ToolCallBlock — our mock adapter is NOT an instance,
	// so vaultPath resolves to "" (irrelevant to these tests).
	FileSystemAdapter: class {},
	// platform.ts (pulled in transitively via the quick-prompt UI) reads
	// Platform.isMacOS at module load for the modifier-label helper (I134).
	Platform: { isMacOS: true, isWin: false, isLinux: false },
}));

// Preserve the className so the status-chip class is assertable in the DOM.
vi.mock("../shared/IconButton", () => ({
	LucideIcon: ({ name, className }: { name: string; className?: string }) => (
		<span data-icon={name} className={className} />
	),
}));

vi.mock("../TerminalBlock", () => ({
	TerminalBlock: () => <div data-testid="terminal" />,
}));

vi.mock("../PermissionBanner", () => ({
	PermissionBanner: () => <div data-testid="permission-banner" />,
}));

// ============================================================================
// Fixtures
// ============================================================================

const mockPlugin = {
	app: { vault: { adapter: {} } },
	settings: { displaySettings: { showEmojis: true } },
	// Minimal manager stub: McpAuthBanner reads pending state on mount.
	mcpAuthManager: {
		getPending: () => [],
		onChange: () => () => {},
	},
} as unknown as AgentClientPlugin;

type ToolCall = Extract<MessageContent, { type: "tool_call" }>;

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
	return {
		type: "tool_call",
		toolCallId: "tc-1",
		title: "get_messages",
		status: "completed",
		kind: "fetch",
		...overrides,
	} as ToolCall;
}

function renderBlock(content: ToolCall) {
	return render(<ToolCallBlock content={content} plugin={mockPlugin} />);
}

// ============================================================================
// Tests
// ============================================================================

describe("CTC-I05: failed tool calls do not auto-expand", () => {
	it("renders a failed tool call COLLAPSED (summary button, aria-expanded=false)", () => {
		const { container } = renderBlock(makeToolCall({ status: "failed" }));

		const summary = container.querySelector(
			"button.agent-client-message-tool-call-summary",
		);
		expect(summary).not.toBeNull();
		expect(summary?.getAttribute("aria-expanded")).toBe("false");

		// The expanded header (only rendered in the expanded branch) is absent.
		expect(
			container.querySelector(
				".agent-client-message-tool-call-header",
			),
		).toBeNull();
	});

	it("flags the failed call with the highlighted status-chip class", () => {
		const { container } = renderBlock(makeToolCall({ status: "failed" }));

		const chip = container.querySelector(
			".agent-client-message-tool-call-status-icon.agent-client-status-failed",
		);
		expect(chip).not.toBeNull();
		// The chip carries the "x" glyph (failure shape, not hue alone).
		expect(chip?.getAttribute("data-icon")).toBe("x");
	});

	it("still AUTO-EXPANDS when a permission is pending (banner must be actionable)", () => {
		const { container } = renderBlock(
			makeToolCall({
				status: "in_progress",
				permissionRequest: {
					requestId: "req-1",
					options: [
						{ optionId: "allow", name: "Allow", kind: "allow_once" },
					],
				},
			} as Partial<ToolCall>),
		);

		// Expanded branch: header div with aria-expanded=true, no summary button.
		const header = container.querySelector(
			".agent-client-message-tool-call-header",
		);
		expect(header).not.toBeNull();
		expect(header?.getAttribute("aria-expanded")).toBe("true");
		expect(
			container.querySelector(
				"button.agent-client-message-tool-call-summary",
			),
		).toBeNull();
	});

	it("renders a completed call collapsed with NO failed chip", () => {
		const { container } = renderBlock(makeToolCall({ status: "completed" }));

		expect(
			container.querySelector(
				"button.agent-client-message-tool-call-summary",
			),
		).not.toBeNull();
		expect(
			container.querySelector(".agent-client-status-failed"),
		).toBeNull();
	});
});

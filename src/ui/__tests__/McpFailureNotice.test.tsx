/**
 * Kiro CLI V3 S4: the in-chat list of MCP servers that didn't connect.
 * Spec: [[Kiro CLI V3 Support]] § T7.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("obsidian", () => import("../../__test_stubs__/obsidian"));

import { McpFailureNotice } from "../McpFailureNotice";
import { McpAuthManager } from "../../services/mcp-auth-manager";
import type { McpAuthEvent, KiroMcpServerStatus } from "../../types/mcp-auth";

function setup() {
	const listeners = new Set<(e: McpAuthEvent) => void>();
	const manager = new McpAuthManager();
	manager.trackClient("view-1", {
		onMcpAuthEvent(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	});
	const emit = (...servers: KiroMcpServerStatus[]) =>
		act(() => {
			for (const cb of listeners) cb({ kind: "status_snapshot", sessionId: "s1", servers });
		});
	return { manager, emit };
}

afterEach(() => cleanup());

describe("McpFailureNotice", () => {
	it("renders nothing while every server is fine", () => {
		const { manager, emit } = setup();
		const { container } = render(<McpFailureNotice manager={manager} viewId="view-1" />);
		emit({ name: "drive", status: "connected", failedAuthorization: false });
		expect(container.innerHTML).toBe("");
	});

	it("lists failed servers with the server's reason, and clears when they connect", () => {
		const { manager, emit } = setup();
		render(<McpFailureNotice manager={manager} viewId="view-1" />);
		emit(
			{ name: "slack", status: "failed", failedAuthorization: false, errorMessage: "spawn slack-mcp ENOENT" },
			{ name: "sheets", status: "failed", failedAuthorization: true },
		);
		expect(screen.getByRole("status").textContent).toContain("didn't connect: slack");
		expect(screen.getByRole("status").textContent).toContain("spawn slack-mcp ENOENT");
		expect(screen.getByRole("status").textContent).not.toContain("sheets");

		emit({ name: "slack", status: "connected", failedAuthorization: false });
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("Dismiss hides the list until the failures change", () => {
		const { manager, emit } = setup();
		render(<McpFailureNotice manager={manager} viewId="view-1" />);
		emit({ name: "slack", status: "failed", failedAuthorization: false, errorMessage: "boom" });
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByRole("status")).toBeNull();
		emit(
			{ name: "slack", status: "failed", failedAuthorization: false, errorMessage: "boom" },
			{ name: "chorus", status: "failed", failedAuthorization: false },
		);
		expect(screen.getByRole("status").textContent).toContain("slack, chorus");
	});
});

// Found in the S4 smoke (2026-10-27): the note never rendered in a new chat,
// because MessageList's empty state returned before reaching it.
describe("MessageList shows the MCP failure note", () => {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};

	it("in an empty chat, before the first message", async () => {
		const { MessageList } = await import("../MessageList");
		const { manager, emit } = setup();
		const plugin = { mcpAuthManager: manager } as never;
		const view = { registerDomEvent: vi.fn() } as never;
		const { container } = render(
			<MessageList
				messages={[]}
				isSending={false}
				lazyState="ready"
				isRestoringSession={false}
				agentLabel="Kiro CLI"
				plugin={plugin}
				view={view}
				hasActivePermission={false}
				viewId="view-1"
			/>,
		);
		emit({ name: "slack", status: "failed", failedAuthorization: false, errorMessage: "boom" });
		expect(container.querySelector(".agent-client-mcp-failure-notice")?.textContent).toContain(
			"didn't connect: slack",
		);
	});
});

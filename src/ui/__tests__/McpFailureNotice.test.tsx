/**
 * Kiro CLI V3 S4: the in-chat list of MCP servers that didn't connect.
 * Spec: [[Kiro CLI V3 Support]] § T7.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

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

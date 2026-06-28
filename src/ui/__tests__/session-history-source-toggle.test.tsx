/**
 * SessionHistoryContent — Local/Agent source toggle, per-row agent badge,
 * migration empty-state, and the disconnected-Agent sync affordance
 * (Session History Source Model, Track 1).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { App } from "obsidian";
import { SessionHistoryContent } from "../SessionHistoryModal";
import type { SessionInfo } from "../../types/session";

const CLAUDE_CAPS = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: true,
	reportsModels: false,
};
const KIRO_CAPS = {
	listsSessions: false,
	restoresViaLoad: false,
	restoresViaResume: true,
	forks: false,
	reportsModels: false,
};

function row(sessionId: string, title: string, agentId?: string): SessionInfo {
	return {
		sessionId,
		cwd: "/vault",
		title,
		updatedAt: "2026-06-28T00:00:00Z",
		agentId,
	};
}

function makeProps(
	overrides: Partial<Parameters<typeof SessionHistoryContent>[0]> = {},
): Parameters<typeof SessionHistoryContent>[0] {
	return {
		app: new App(),
		sessions: [],
		loading: false,
		error: null,
		hasMore: false,
		currentCwd: "/vault",
		loadSessionMessages: vi.fn(async () => null),
		capabilities: CLAUDE_CAPS,
		localSessionIds: new Set<string>(),
		isAgentReady: true,
		debugMode: false,
		initialSource: "local",
		agentSessionCache: null,
		agentLabels: { claude: "Claude Code", kiro: "Kiro CLI" },
		onRestoreSession: vi.fn(async () => {}),
		onDeleteSession: vi.fn(),
		onEditTitle: vi.fn(),
		onLoadMore: vi.fn(),
		onFetchSessions: vi.fn(),
		onSourceChange: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

describe("SessionHistoryContent — Local/Agent toggle", () => {
	afterEach(cleanup);

	it("renders the Local/Agent toggle for a listing agent (Claude)", () => {
		render(<SessionHistoryContent {...makeProps()} />);
		expect(screen.getByRole("tab", { name: "Local" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Agent" })).toBeTruthy();
	});

	it("hides the toggle for a non-listing agent (Kiro shows only the unified Local store)", () => {
		render(
			<SessionHistoryContent
				{...makeProps({ capabilities: KIRO_CAPS })}
			/>,
		);
		expect(screen.queryByRole("tab", { name: "Agent" })).toBeNull();
	});

	it("clicking Agent persists the choice and refetches from the agent", () => {
		const onSourceChange = vi.fn();
		const onFetchSessions = vi.fn();
		render(
			<SessionHistoryContent
				{...makeProps({ onSourceChange, onFetchSessions })}
			/>,
		);
		fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
		expect(onSourceChange).toHaveBeenCalledWith("agent");
		expect(onFetchSessions).toHaveBeenCalledWith("agent", "/vault");
	});

	it("defaults the Local pill active and hides the 'This vault only' filter on Local", () => {
		render(<SessionHistoryContent {...makeProps()} />);
		expect(
			screen.getByRole("tab", { name: "Local" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.queryByText("This vault only")).toBeNull();
	});

	it("shows the 'This vault only' filter only on the Agent view", () => {
		render(
			<SessionHistoryContent {...makeProps({ initialSource: "agent" })} />,
		);
		expect(screen.getByText("This vault only")).toBeTruthy();
	});
});

describe("SessionHistoryContent — per-row agent badge", () => {
	afterEach(cleanup);

	it("renders the agent display name as a badge on Local rows", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [row("c1", "a claude session", "claude")],
				})}
			/>,
		);
		expect(screen.getByText("Claude Code")).toBeTruthy();
	});
});

describe("SessionHistoryContent — migration empty-state", () => {
	afterEach(cleanup);

	it("points to the Agent view when Local is empty and the agent can list", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [],
					agentSessionCache: {
						sessions: [
							{ sessionId: "s1", cwd: "/vault", title: "x" },
							{ sessionId: "s2", cwd: "/vault", title: "y" },
						],
						syncedAt: "2026-06-28T00:00:00Z",
					},
				})}
			/>,
		);
		expect(
			screen.getByText(/No local sessions yet\. Your agent has 2/),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "View agent sessions" }),
		).toBeTruthy();
	});

	it("shows the plain empty message for a non-listing agent (no migration prompt)", () => {
		render(
			<SessionHistoryContent
				{...makeProps({ sessions: [], capabilities: KIRO_CAPS })}
			/>,
		);
		expect(screen.getByText("No previous sessions")).toBeTruthy();
		expect(screen.queryByText(/view them under Agent/)).toBeNull();
	});
});

describe("SessionHistoryContent — disconnected Agent view (cache + affordance)", () => {
	afterEach(cleanup);

	it("renders cached rows + a 'connect to refresh' affordance when not ready", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					initialSource: "agent",
					isAgentReady: false,
					agentSessionCache: {
						sessions: [
							{ sessionId: "srv1", cwd: "/vault", title: "server row" },
						],
						syncedAt: "2026-06-28T00:00:00Z",
					},
				})}
			/>,
		);
		expect(screen.getByText(/connect to refresh/)).toBeTruthy();
		expect(screen.getByText("server row")).toBeTruthy();
	});

	it("prompts to connect when there is no cache yet", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					initialSource: "agent",
					isAgentReady: false,
					agentSessionCache: null,
				})}
			/>,
		);
		expect(
			screen.getByText("Connect to load sessions from the agent"),
		).toBeTruthy();
	});
});

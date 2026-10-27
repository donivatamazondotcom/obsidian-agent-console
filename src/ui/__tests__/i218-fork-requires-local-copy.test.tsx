/**
 * I218 — Forking an agent-only session opens a blank tab.
 *
 * Session History Source Model § "Why mirror splits in two": an un-imported
 * Agent-view row offers only open/resume, import-to-Local, title display, and
 * title-only search. Fork is not in that set. A row with no local copy has no
 * transcript to seed the fork tab with (`ChatView.openSessionInTab` seeds only
 * from `persistenceStorage.loadSessionMessages`, and `session/fork` does not
 * replay history), so the fork tab opens blank. On an agent that lists
 * sessions but cannot fork, the local-branch fallback is worse: a fresh
 * session seeded with an empty transcript, so the context is actually lost.
 *
 * Fix direction (3): fork is offered on an Agent-view row only when that row
 * has a local copy. The Local view is unaffected.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { App } from "obsidian";
import { SessionHistoryContent } from "../SessionHistoryModal";
import type { SessionInfo } from "../../types/session";

/** Lists sessions, restores via load, forks server-side (Kiro V3 shape). */
const LISTING_FORKING_CAPS = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: true,
	reportsModels: false,
};

/** Lists sessions and restores via load, but cannot fork (local-branch path). */
const LISTING_NON_FORKING_CAPS = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: false,
	reportsModels: false,
};

const FORK_LABEL = "Fork session into a new tab";
const RESTORE_LABEL_RE = /restore|resume|open/i;

function row(sessionId: string, title: string): SessionInfo {
	return {
		sessionId,
		cwd: "/vault",
		title,
		updatedAt: "2026-10-27T00:00:00Z",
		agentId: "kiro",
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
		capabilities: LISTING_FORKING_CAPS,
		localSessionIds: new Set<string>(),
		isAgentReady: true,
		debugMode: false,
		initialSource: "agent",
		agentSessionCache: null,
		agentLabels: { kiro: "Kiro CLI" },
		currentAgentLabel: "Kiro CLI",
		onRestoreSession: vi.fn(async () => {}),
		onForkSession: vi.fn(async () => {}),
		onDeleteSession: vi.fn(),
		onEditTitle: vi.fn(),
		onLoadMore: vi.fn(),
		onFetchSessions: vi.fn(),
		onSourceChange: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

describe("I218 — fork on Agent-view rows requires a local copy", () => {
	afterEach(cleanup);

	for (const [name, capabilities] of [
		["fork-capable agent", LISTING_FORKING_CAPS],
		["non-fork-capable agent (local-branch path)", LISTING_NON_FORKING_CAPS],
	] as const) {
		describe(name, () => {
			it("hides fork on an agent-only row (no local copy)", () => {
				render(
					<SessionHistoryContent
						{...makeProps({
							capabilities,
							sessions: [row("srv-1", "server only session")],
							localSessionIds: new Set<string>(),
						})}
					/>,
				);
				// The row itself still renders (title display is allowed).
				expect(screen.getByText("server only session")).toBeTruthy();
				expect(
					screen.queryByRole("button", { name: FORK_LABEL }),
				).toBeNull();
			});

			it("keeps open/resume on an agent-only row", () => {
				render(
					<SessionHistoryContent
						{...makeProps({
							capabilities,
							sessions: [row("srv-1", "server only session")],
						})}
					/>,
				);
				expect(
					screen
						.getAllByRole("button")
						.some((b) =>
							RESTORE_LABEL_RE.test(b.getAttribute("aria-label") ?? ""),
						),
				).toBe(true);
			});

			it("shows fork on an Agent-view row that has a local copy", () => {
				render(
					<SessionHistoryContent
						{...makeProps({
							capabilities,
							sessions: [row("loc-1", "imported session")],
							localSessionIds: new Set(["loc-1"]),
						})}
					/>,
				);
				expect(
					screen.getByRole("button", { name: FORK_LABEL }),
				).toBeTruthy();
			});
		});
	}

	it("mixed list: fork appears on the local-copy row only", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [
						row("loc-1", "imported session"),
						row("srv-1", "server only session"),
					],
					localSessionIds: new Set(["loc-1"]),
				})}
			/>,
		);
		expect(screen.getAllByRole("button", { name: FORK_LABEL })).toHaveLength(
			1,
		);
	});

	it("Local view is unaffected: every row offers fork", () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					initialSource: "local",
					sessions: [row("a", "first"), row("b", "second")],
					localSessionIds: new Set(["a", "b"]),
				})}
			/>,
		);
		expect(screen.getAllByRole("button", { name: FORK_LABEL })).toHaveLength(
			2,
		);
	});
});

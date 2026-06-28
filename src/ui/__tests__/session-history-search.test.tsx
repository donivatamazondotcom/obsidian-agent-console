/**
 * Component tests for session-search wired into SessionHistoryContent (modal).
 * T10: typing filters the rendered list; clearing restores the full list.
 * T11: a content match renders a highlighted snippet preview.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	render,
	screen,
	fireEvent,
	cleanup,
	waitFor,
} from "@testing-library/react";
import { App } from "obsidian";
import { SessionHistoryContent } from "../SessionHistoryModal";
import type { SessionInfo } from "../../types/session";
import type { ChatMessage } from "../../types/chat";

function session(sessionId: string, title: string): SessionInfo {
	return {
		sessionId,
		cwd: "/vault",
		title,
		updatedAt: "2026-06-23T00:00:00Z",
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
		capabilities: {
			listsSessions: false,
			restoresViaLoad: false,
			restoresViaResume: true,
			forks: false,
			reportsModels: false,
		},
		localSessionIds: new Set<string>(),
		isAgentReady: true,
		debugMode: false,
		onRestoreSession: vi.fn(async () => {}),
		onDeleteSession: vi.fn(),
		onEditTitle: vi.fn(),
		onLoadMore: vi.fn(),
		onFetchSessions: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

describe("SessionHistoryContent — search", () => {
	afterEach(cleanup);

	it("T10: typing filters by title; clearing restores the full list", async () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [
						session("a", "wikilink debugging"),
						session("b", "travel planning"),
					],
				})}
			/>,
		);

		// Both present initially.
		expect(screen.getByText("wikilink debugging")).toBeTruthy();
		expect(screen.getByText("travel planning")).toBeTruthy();

		const input = screen.getByLabelText("Search sessions");
		fireEvent.change(input, { target: { value: "wikilink" } });

		await waitFor(() => {
			expect(screen.queryByText("travel planning")).toBeNull();
		});
		// Title is split by the highlight <mark>, so match on the row text.
		expect(
			screen.getByText(
				(_c, el) =>
					el?.classList.contains(
						"agent-client-session-history-item-title",
					) === true && el?.textContent === "wikilink debugging",
			),
		).toBeTruthy();

		// Clear → both return.
		fireEvent.change(input, { target: { value: "" } });
		await waitFor(() => {
			expect(screen.getByText("travel planning")).toBeTruthy();
		});
	});

	it("shows a no-results message when nothing matches", async () => {
		render(
			<SessionHistoryContent
				{...makeProps({ sessions: [session("a", "travel planning")] })}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Search sessions"), {
			target: { value: "zzzznomatch" },
		});
		await waitFor(() => {
			expect(
				screen.getByText("No sessions match your search"),
			).toBeTruthy();
		});
	});

	it("T11: a content match renders a highlighted snippet", async () => {
		const messages: ChatMessage[] = [
			{
				id: "m1",
				role: "user",
				content: [
					{
						type: "text",
						text: "earlier we discussed kubernetes networking at length",
					},
				],
				timestamp: new Date(),
			},
		];
		const loadSessionMessages = vi.fn(async () => messages);

		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [session("a", "Untitled session")],
					loadSessionMessages,
				})}
			/>,
		);

		const input = screen.getByLabelText("Search sessions");
		// First keystroke builds the content index and sets the query.
		fireEvent.change(input, { target: { value: "kubernetes" } });
		await waitFor(() =>
			expect(loadSessionMessages).toHaveBeenCalled(),
		);

		// Snippet appears with the term highlighted in a <mark>.
		const mark = await waitFor(() =>
			screen.getByText(
				(_content, el) =>
					el?.tagName.toLowerCase() === "mark" &&
					el.textContent?.toLowerCase() === "kubernetes",
			),
		);
		expect(mark).toBeTruthy();
		expect(
			mark.classList.contains(
				"agent-client-session-history-item-snippet-match",
			),
		).toBe(true);
	});

	it("T12: auto-focuses the search box when the modal opens (I94)", () => {
		render(
			<SessionHistoryContent
				{...makeProps({ sessions: [session("a", "anything")] })}
			/>,
		);
		expect(document.activeElement).toBe(
			screen.getByLabelText("Search sessions"),
		);
	});

	it("T13: highlights the query within a matching title", async () => {
		render(
			<SessionHistoryContent
				{...makeProps({
					sessions: [session("a", "obsidian skill notes")],
				})}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Search sessions"), {
			target: { value: "obsidian" },
		});
		const mark = await waitFor(() =>
			screen.getByText(
				(_c, el) =>
					el?.tagName.toLowerCase() === "mark" &&
					el.textContent?.toLowerCase() === "obsidian",
			),
		);
		expect(
			mark.classList.contains("agent-client-session-history-match"),
		).toBe(true);
	});

	it("T14: action icons use clickable-icon (regression: blank buttons after div→button)", () => {
		render(
			<SessionHistoryContent
				{...makeProps({ sessions: [session("a", "anything")] })}
			/>,
		);
		// Each action button must carry `clickable-icon` so Obsidian resets the
		// native button chrome (background/border/padding) and the setIcon SVG
		// is visible. Without it the buttons render as blank grey squares.
		for (const label of [
			"Edit session title",
			"Restore session",
			"Delete session",
		]) {
			const btn = screen.getByLabelText(label);
			expect(btn.tagName.toLowerCase()).toBe("button");
			expect(btn.classList.contains("clickable-icon")).toBe(true);
		}
	});
});

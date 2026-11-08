/**
 * I227 / I224 — reproduce-first, modal row → restored tab label.
 *
 * Restoring a history row opens a tab whose label `ChatView.openSessionInTab`
 * takes from `deriveRestoreTabLabel`, fed with the saved record's title (if
 * any) and the row's title, which the row hands to `onRestoreSession`. The tab
 * must read the same as the row the user clicked:
 * - a row the plugin has a record of shows the local title, and so does the tab
 * - an agent-only row (no record) labels the tab with the row's title, not the
 *   generic "Session" (I227)
 * - a row with no usable title reads the same fallback on both.
 *
 * The test drives the real modal content and the real resolver; only the
 * restore callback is captured (it is the modal → ChatView boundary). The
 * label inputs mirror ChatView's call exactly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { App } from "obsidian";
import { SessionHistoryContent } from "../SessionHistoryModal";
import { deriveRestoreTabLabel } from "../../resolvers/session-title";
import { defaultSessionTitle } from "../../utils/format-session-title";
import { t } from "../../i18n";
import { TITLE_RUBRIC } from "../../utils/system-instructions";
import type { SavedSessionInfo, SessionInfo } from "../../types/session";

const CAPS = {
	listsSessions: true,
	restoresViaLoad: true,
	restoresViaResume: false,
	forks: false,
	closesSessions: false,
	deletesSessions: false,
	reportsModels: false,
};
const RESTORE_LABEL_RE = /restore|resume|open/i;

function rowOf(sessionId: string, title?: string): SessionInfo {
	return {
		sessionId,
		cwd: "/vault",
		title,
		updatedAt: "2026-10-27T00:00:00Z",
		agentId: "kiro-cli",
	};
}

/**
 * Render one Agent-view row, click its restore button, then compute the tab
 * label exactly the way ChatView.openSessionInTab does.
 */
function restoreAndLabel(
	row: SessionInfo,
	saved: SavedSessionInfo[],
): { rowText: string; tabLabel: string } {
	const onRestoreSession = vi.fn(async () => {});
	render(
		<SessionHistoryContent
			app={new App()}
			sessions={[row]}
			loading={false}
			error={null}
			hasMore={false}
			currentCwd="/vault"
			loadSessionMessages={vi.fn(async () => null)}
			capabilities={CAPS}
			localSessionIds={new Set(saved.map((s) => s.sessionId))}
			isAgentReady
			debugMode={false}
			initialSource="agent"
			agentSessionCache={null}
			agentLabels={{ "kiro-cli": "Kiro CLI" }}
			currentAgentLabel="Kiro CLI"
			onRestoreSession={onRestoreSession}
			onForkSession={vi.fn(async () => {})}
			onDeleteSession={vi.fn()}
			onEditTitle={vi.fn()}
			onLoadMore={vi.fn()}
			onFetchSessions={vi.fn()}
			onSourceChange={vi.fn()}
			onClose={vi.fn()}
		/>,
	);
	const rowText =
		document.querySelector(".agent-client-session-history-item-title")
			?.textContent ?? "";
	const restore = screen
		.getAllByRole("button")
		.find((b) => RESTORE_LABEL_RE.test(b.getAttribute("aria-label") ?? ""));
	fireEvent.click(restore!);
	const [sessionId, , agentTitle] = onRestoreSession.mock.calls[0] as unknown as [
		string,
		string,
		string | undefined,
	];
	const record = saved.find((s) => s.sessionId === sessionId);
	const tabLabel = deriveRestoreTabLabel({
		mode: "restore",
		savedTitle: record?.title,
		agentTitle,
		savedTitles: saved.map((s) => s.title ?? ""),
		fallback: defaultSessionTitle(),
		forkLabel: (base) => t("chat.tabs.forkPrefix", { label: base }),
	});
	return { rowText, tabLabel };
}

const record = (sessionId: string, title: string): SavedSessionInfo => ({
	recordId: sessionId,
	sessionId,
	agentId: "kiro-cli",
	cwd: "/vault",
	title,
	createdAt: "2026-10-27T00:00:00Z",
	updatedAt: "2026-10-27T00:00:00Z",
});

describe("I227 — restored tab label matches the history row", () => {
	afterEach(cleanup);

	it("agent-only row: the tab takes the row's title, not 'Session'", () => {
		const { rowText, tabLabel } = restoreAndLabel(
			rowOf("srv", "Kiro integration with Obsidian"),
			[],
		);
		expect(rowText).toBe("Kiro integration with Obsidian");
		expect(tabLabel).toBe("Kiro integration with Obsidian");
	});

	it("row with a local record (overlaid title): row and tab agree", () => {
		// The row reaches the modal already carrying the local title (I224).
		const { rowText, tabLabel } = restoreAndLabel(
			rowOf("bravo", "I219 renamed BRAVO"),
			[record("bravo", "I219 renamed BRAVO")],
		);
		expect(tabLabel).toBe(rowText);
	});

	it("agent-only row with no usable title: row and tab show the same fallback", () => {
		const { rowText, tabLabel } = restoreAndLabel(rowOf("srv"), []);
		expect(rowText).toBe(defaultSessionTitle());
		expect(tabLabel).toBe(rowText);
	});
});

describe("I243 — Claude Code's title-instruction title on an agent-only row", () => {
	afterEach(cleanup);

	it("the restored tab falls back to the untitled text", () => {
		// Rendered raw here, as the restore callback receives it; the live
		// overlay that clears the row's title is pinned in i224-agent-row-titles.
		const { tabLabel } = restoreAndLabel(
			rowOf("ec137294", TITLE_RUBRIC.slice(0, 181).trimEnd() + "…"),
			[],
		);
		expect(tabLabel).toBe(defaultSessionTitle());
	});
});

describe("I245 — Kiro's 'New Session' default on an agent-only row", () => {
	afterEach(cleanup);

	it("the restored tab falls back to the untitled text", () => {
		const { tabLabel } = restoreAndLabel(rowOf("1c224775", "New Session"), []);
		expect(tabLabel).toBe(defaultSessionTitle());
	});
});

describe("deriveRestoreTabLabel — fork keeps its prefix and suffix", () => {
	it("prefixes and suffixes a fork against saved titles", () => {
		expect(
			deriveRestoreTabLabel({
				mode: "fork",
				savedTitle: "Plan",
				savedTitles: ["Fork: Plan"],
				fallback: "Untitled Session",
				forkLabel: (b) => `Fork: ${b}`,
			}),
		).toBe("Fork: Plan (2)");
	});
});

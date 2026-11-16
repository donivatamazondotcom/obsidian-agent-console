/**
 * Chat ID T47 — Copy link to chat's three outcomes ([[Agent Console Chat ID]]
 * D16): a recorded chat copies its link and confirms; a failed clipboard
 * write is logged and reported; a chat with no record shows the send-first
 * notice and writes nothing. Focus lands in the active tab's composer in
 * every case.
 *
 * Seams (R2): the real `runChatLinkCopy`, the real focus resolver it routes
 * through, and the real `scheduleComposerRefocus` on a DOM tab-panel
 * structure. Only the clipboard, notices and logging are injected (R4: the
 * browser / Obsidian boundary).
 *
 * Assertions (R3): the clipboard text, the notice text and
 * `document.activeElement` after the frame. Literals (R5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatLinkCopy } from "../chat-link-copy";
import { scheduleComposerRefocus } from "../../ui/composer-focus";
import type { SavedSessionInfo } from "../../types/session";

const RECORD: SavedSessionInfo = {
	recordId: "rec-7",
	sessionId: "sess-7",
	agentId: "kiro",
	cwd: "/vault",
	title: "Number memory test",
	createdAt: "2026-11-02T09:00:00.000Z",
	updatedAt: "2026-11-02T09:05:00.000Z",
};

let container: HTMLElement;
let activeComposer: HTMLTextAreaElement;
let tabEl: HTMLButtonElement;

function mountView() {
	container = document.createElement("div");
	// A hidden background tab first, then the active one: focus must land on
	// the ACTIVE tab's composer, not the first in the DOM.
	const hidden = document.createElement("div");
	hidden.style.display = "none";
	const hiddenTa = document.createElement("textarea");
	hiddenTa.className = "agent-client-chat-input-textarea";
	hidden.appendChild(hiddenTa);
	const active = document.createElement("div");
	activeComposer = document.createElement("textarea");
	activeComposer.className = "agent-client-chat-input-textarea";
	active.appendChild(activeComposer);
	// The right-clicked tab, which holds focus when the menu item runs.
	tabEl = document.createElement("button");
	container.append(tabEl, hidden, active);
	document.body.appendChild(container);
}

async function nextFrame() {
	await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
}

beforeEach(() => {
	mountView();
	tabEl.focus();
});
afterEach(() => container.remove());

function deps(writeText: (t: string) => Promise<void>) {
	return {
		writeText: vi.fn(writeText),
		notify: vi.fn(),
		logError: vi.fn(),
		refocus: () => scheduleComposerRefocus(container),
	};
}

function prefixedOnce(message: string) {
	return (
		message.startsWith("[Agent Console] ") &&
		message.indexOf("[Agent Console]", 1) === -1
	);
}

describe("Chat ID T47: Copy link to chat", () => {
	it("a recorded chat: copies its link, confirms, and focus lands in the active composer", async () => {
		let clip = "";
		const d = deps(async (t) => {
			clip = t;
		});
		const outcome = await runChatLinkCopy(
			{
				recordId: "rec-7",
				records: [RECORD],
				title: "Plan [draft]",
				vaultName: "My Vault",
			},
			d,
		);
		await nextFrame();
		expect(outcome).toBe("copied");
		expect(clip).toBe(
			"[Plan \\[draft\\]](obsidian://agent-console-chat?vault=My%20Vault&id=rec-7)",
		);
		expect(d.notify).toHaveBeenCalledTimes(1);
		expect(d.notify).toHaveBeenCalledWith("[Agent Console] Copied chat link.");
		expect(prefixedOnce(d.notify.mock.calls[0][0] as string)).toBe(true);
		expect(document.activeElement).toBe(activeComposer);
	});

	it("a failed clipboard write: logs it, reports it, and focus still returns", async () => {
		const err = new Error("Document is not focused");
		const d = deps(async () => {
			throw err;
		});
		const outcome = await runChatLinkCopy(
			{
				recordId: "rec-7",
				records: [RECORD],
				title: "Plan",
				vaultName: "My Vault",
			},
			d,
		);
		await nextFrame();
		expect(outcome).toBe("copy-failed");
		expect(d.logError).toHaveBeenCalledWith(
			"[ChatLink] copy link failed",
			err,
		);
		expect(d.notify).toHaveBeenCalledTimes(1);
		expect(d.notify).toHaveBeenCalledWith(
			"[Agent Console] Couldn't copy the chat link.",
		);
		expect(prefixedOnce(d.notify.mock.calls[0][0] as string)).toBe(true);
		expect(document.activeElement).toBe(activeComposer);
	});

	it("no record yet: shows the send-first notice, writes nothing, and focus returns", async () => {
		const d = deps(async () => {});
		// A bound id whose record isn't written yet counts as no ID (D7).
		const outcome = await runChatLinkCopy(
			{
				recordId: "minted-not-saved",
				records: [RECORD],
				title: "Plan",
				vaultName: "My Vault",
			},
			d,
		);
		await nextFrame();
		expect(outcome).toBe("no-id");
		expect(d.writeText).not.toHaveBeenCalled();
		expect(d.notify).toHaveBeenCalledTimes(1);
		expect(d.notify).toHaveBeenCalledWith(
			"[Agent Console] Send a message first to get a link to this chat.",
		);
		expect(prefixedOnce(d.notify.mock.calls[0][0] as string)).toBe(true);
		expect(document.activeElement).toBe(activeComposer);
	});

	it("an empty binding (a tab that never sent) is the same no-ID case", async () => {
		const d = deps(async () => {});
		const outcome = await runChatLinkCopy(
			{ recordId: "", records: [RECORD], title: "Plan", vaultName: "V" },
			d,
		);
		expect(outcome).toBe("no-id");
		expect(d.writeText).not.toHaveBeenCalled();
	});
});

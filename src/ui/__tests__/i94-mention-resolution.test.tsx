/**
 * I94 (part C) — a `@[[mention]]` whose basename is ambiguous (two notes share
 * the name) must resolve via `metadataCache.getFirstLinkpathDest(name,
 * sourcePath)` — Obsidian's sanctioned resolver — not `getMarkdownFiles()
 * .find(basename === name)`, which returns an arbitrary first match.
 */

import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, act } from "@testing-library/react";

import { MessageBubble } from "../MessageBubble";
import type { ChatMessage } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";

const ACTIVE_PATH = "src/Active.md";
const CORRECT = "correct/Dup.md";
const WRONG = "wrong/Dup.md";

vi.mock("obsidian", () => ({
	MarkdownRenderer: { render: vi.fn() },
	Component: class {
		load() {}
		unload() {}
	},
	FileSystemAdapter: class {
		getBasePath() {
			return "/mock/vault";
		}
	},
	Platform: { isWin: false },
	Keymap: { isModEvent: vi.fn(() => false) },
	Notice: class {
		constructor(_m: string) {}
	},
	setIcon: vi.fn(),
}));

function makePlugin(openLinkText: ReturnType<typeof vi.fn>) {
	return {
		app: {
			vault: {
				adapter: { getBasePath: () => "/mock/vault" },
				// First match is the WRONG one — the old .find() path would pick it.
				getMarkdownFiles: () => [
					{ basename: "Dup", path: WRONG },
					{ basename: "Dup", path: CORRECT },
				],
			},
			metadataCache: {
				getFirstLinkpathDest: (_lp: string, _sp: string) => ({
					path: CORRECT,
				}),
			},
			workspace: {
				openLinkText,
				getActiveFile: () => ({ path: ACTIVE_PATH }),
			},
		},
		settings: {
			windowsWslMode: false,
			displaySettings: { showEmojis: false },
		},
	} as unknown as AgentClientPlugin;
}

function userMessage(text: string): ChatMessage {
	return {
		id: "m1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

describe("I94 part C — ambiguous mention resolves via getFirstLinkpathDest", () => {
	it("clicking the mention opens the resolver's dest, not the first basename match", async () => {
		const openLinkText = vi.fn();
		const plugin = makePlugin(openLinkText);

		const { container } = await act(async () =>
			render(
				<MessageBubble
					message={userMessage("see @[[Dup]] here")}
					plugin={plugin}
				/>,
			),
		);

		const mention = container.querySelector(".agent-client-text-mention")!;
		expect(mention).toBeTruthy();
		expect(mention.textContent).toContain("Dup");

		await act(async () => {
			mention.dispatchEvent(
				new MouseEvent("click", { bubbles: true, button: 0 }),
			);
		});

		expect(openLinkText).toHaveBeenCalledTimes(1);
		expect(openLinkText.mock.calls[0][0]).toBe(CORRECT);
		expect(openLinkText.mock.calls[0][1]).toBe(ACTIVE_PATH);
	});
});

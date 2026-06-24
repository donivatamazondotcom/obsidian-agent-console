/**
 * I94 (part B) — Clicking an *unresolved* internal link in the chat transcript
 * must NOT silently create a stray note.
 *
 * Repro: a parallel session's chat output contained `[[Resume - land PR 80
 * tools lint]]`; that note was consumed/deleted mid-session, so the wikilink
 * is now dangling. Obsidian's `MarkdownRenderer.render` tags such links with
 * the `.is-unresolved` class. The old click handler treated every
 * `a.internal-link` identically and called `openLinkText(href, "", newLeaf)`,
 * which for a nonexistent target Obsidian resolves by *creating* an empty note
 * in the default new-note folder — the "doesn't have the right path" symptom.
 *
 * Desired behavior: on an unresolved link, surface a `Notice` and no-op —
 * never call `openLinkText` (which would create the note).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, act } from "@testing-library/react";

import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type AgentClientPlugin from "../../plugin";

const noticeSpy = vi.fn();

vi.mock("obsidian", () => ({
	// Simulate Obsidian rendering an UNRESOLVED wikilink: an anchor carrying
	// both `internal-link` and `is-unresolved`, with the link text in data-href.
	MarkdownRenderer: {
		render: vi.fn((_app: unknown, text: string, el: HTMLElement) => {
			const a = el.ownerDocument.createElement("a");
			a.className = "internal-link is-unresolved";
			a.setAttribute("data-href", text);
			a.textContent = text;
			el.appendChild(a);
			return Promise.resolve();
		}),
	},
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
		constructor(message: string) {
			noticeSpy(message);
		}
	},
}));

function makePlugin(openLinkText: ReturnType<typeof vi.fn>): AgentClientPlugin {
	return {
		app: {
			vault: {
				adapter: { getBasePath: () => "/mock/vault" },
			},
			workspace: { openLinkText, getActiveFile: () => null },
		},
		settings: { windowsWslMode: false },
	} as unknown as AgentClientPlugin;
}

describe("I94 part B — unresolved chat link does not create a stray note", () => {
	beforeEach(() => {
		noticeSpy.mockClear();
	});

	it("clicking an .is-unresolved link surfaces a Notice and never calls openLinkText", async () => {
		const openLinkText = vi.fn();
		const plugin = makePlugin(openLinkText);

		const { container } = await act(async () =>
			render(
				<MarkdownRenderer
					text="Resume - land PR 80 tools lint"
					plugin={plugin}
				/>,
			),
		);

		const link = container.querySelector("a.internal-link.is-unresolved");
		expect(link).not.toBeNull();

		await act(async () => {
			link!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, button: 0 }),
			);
		});

		// The dead link must NOT be opened/created.
		expect(openLinkText).not.toHaveBeenCalled();
		// The user must be told the target is gone.
		expect(noticeSpy).toHaveBeenCalledTimes(1);
		expect(noticeSpy.mock.calls[0][0]).toContain(
			"Resume - land PR 80 tools lint",
		);
	});
});

/**
 * I98 — chat links match native Obsidian behavior for unresolved targets.
 *
 * Supersedes the I94/#99 "Note not found" guard, which invented non-native
 * behavior. `MarkdownRenderer.render` does NOT apply the reading-view
 * post-processor that marks dead links `.is-unresolved` (verified against the
 * Obsidian forum / Dataview), so:
 *   - we add `.is-unresolved` ourselves (via metadataCache.getFirstLinkpathDest)
 *     so dead links are styled like native Obsidian dead links, and
 *   - clicking a dead link is left to Obsidian's openLinkText, which creates
 *     the note — exactly like reading view (no custom Notice/bail).
 */

import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, act } from "@testing-library/react";

import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type AgentClientPlugin from "../../plugin";

const ACTIVE_PATH = "folder/Active Note.md";

vi.mock("obsidian", () => ({
	MarkdownRenderer: {
		render: vi.fn((_app: unknown, text: string, el: HTMLElement) => {
			// Emit a plain internal link with NO is-unresolved class — exactly
			// what the programmatic render API produces, dead target or not.
			const a = el.ownerDocument.createElement("a");
			a.className = "internal-link";
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
}));

function makePlugin(resolves: boolean) {
	const openLinkText = vi.fn();
	const plugin = {
		app: {
			vault: { adapter: { getBasePath: () => "/mock/vault" } },
			metadataCache: {
				getFirstLinkpathDest: (_lp: string, _sp: string) =>
					resolves ? { path: "real/Target.md" } : null,
			},
			workspace: {
				openLinkText,
				trigger: vi.fn(),
				getActiveFile: () => ({ path: ACTIVE_PATH }),
			},
		},
		settings: { windowsWslMode: false },
	} as unknown as AgentClientPlugin;
	return { plugin, openLinkText };
}

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("I98 — native unresolved-link behavior", () => {
	it("marks a dead link .is-unresolved after render", async () => {
		const { plugin } = makePlugin(false);
		const { container } = await act(async () =>
			render(<MarkdownRenderer text="Zzz Missing" plugin={plugin} />),
		);
		await flushMicrotasks();
		const link = container.querySelector("a.internal-link")!;
		expect(link.classList.contains("is-unresolved")).toBe(true);
	});

	it("does NOT mark a resolved link", async () => {
		const { plugin } = makePlugin(true);
		const { container } = await act(async () =>
			render(<MarkdownRenderer text="Real Target" plugin={plugin} />),
		);
		await flushMicrotasks();
		const link = container.querySelector("a.internal-link")!;
		expect(link.classList.contains("is-unresolved")).toBe(false);
	});

	it("clicking a dead link calls openLinkText (native create), no bail", async () => {
		const { plugin, openLinkText } = makePlugin(false);
		const { container } = await act(async () =>
			render(<MarkdownRenderer text="Zzz Missing" plugin={plugin} />),
		);
		await flushMicrotasks();
		const link = container.querySelector("a.internal-link")!;
		await act(async () => {
			link.dispatchEvent(
				new MouseEvent("click", { bubbles: true, button: 0 }),
			);
		});
		expect(openLinkText).toHaveBeenCalledTimes(1);
		expect(openLinkText.mock.calls[0][0]).toBe("Zzz Missing");
		expect(openLinkText.mock.calls[0][1]).toBe(ACTIVE_PATH);
	});
});

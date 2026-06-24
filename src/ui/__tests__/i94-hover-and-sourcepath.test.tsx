/**
 * I94 (parts A & C) — chat links should integrate with the Page Preview core
 * plugin (hover popover) and resolve relative to a real source path.
 *
 * Part A: hovering a resolved internal link must dispatch the `hover-link`
 *         workspace event so the Page Preview plugin shows the file popover
 *         (and the modifier hint). The chat view never did this before.
 * Part C: `MarkdownRenderer.render` and `openLinkText` must receive the active
 *         file's path as `sourcePath` (not ""), so an ambiguous basename
 *         resolves deterministically instead of from the vault root.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, act } from "@testing-library/react";

import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type AgentClientPlugin from "../../plugin";

const ACTIVE_PATH = "folder/Active Note.md";
let lastRenderSourcePath: string | undefined;

vi.mock("obsidian", () => ({
	// Resolved internal link (no `.is-unresolved`).
	MarkdownRenderer: {
		render: vi.fn(
			(_app: unknown, text: string, el: HTMLElement, sourcePath: string) => {
				lastRenderSourcePath = sourcePath;
				const a = el.ownerDocument.createElement("a");
				a.className = "internal-link";
				a.setAttribute("data-href", text);
				a.textContent = text;
				el.appendChild(a);
				return Promise.resolve();
			},
		),
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
		constructor(_m: string) {}
	},
}));

function makePlugin() {
	const trigger = vi.fn();
	const openLinkText = vi.fn();
	const plugin = {
		app: {
			vault: { adapter: { getBasePath: () => "/mock/vault" } },
			workspace: {
				openLinkText,
				trigger,
				getActiveFile: () => ({ path: ACTIVE_PATH }),
			},
		},
		settings: { windowsWslMode: false },
	} as unknown as AgentClientPlugin;
	return { plugin, trigger, openLinkText };
}

describe("I94 parts A & C — hover preview + deterministic sourcePath", () => {
	beforeEach(() => {
		lastRenderSourcePath = undefined;
	});

	it("renders markdown with the active file as sourcePath (C)", async () => {
		const { plugin } = makePlugin();
		await act(async () =>
			render(<MarkdownRenderer text="Some Note" plugin={plugin} />),
		);
		expect(lastRenderSourcePath).toBe(ACTIVE_PATH);
	});

	it("clicking a resolved link opens it with the active-file sourcePath (C)", async () => {
		const { plugin, openLinkText } = makePlugin();
		const { container } = await act(async () =>
			render(<MarkdownRenderer text="Some Note" plugin={plugin} />),
		);
		const link = container.querySelector("a.internal-link")!;
		await act(async () => {
			link.dispatchEvent(
				new MouseEvent("click", { bubbles: true, button: 0 }),
			);
		});
		expect(openLinkText).toHaveBeenCalledTimes(1);
		expect(openLinkText.mock.calls[0][0]).toBe("Some Note");
		expect(openLinkText.mock.calls[0][1]).toBe(ACTIVE_PATH);
	});

	it("hovering a resolved link dispatches the hover-link event (A)", async () => {
		const { plugin, trigger } = makePlugin();
		const { container } = await act(async () =>
			render(<MarkdownRenderer text="Some Note" plugin={plugin} />),
		);
		const link = container.querySelector("a.internal-link")!;
		await act(async () => {
			link.dispatchEvent(
				new MouseEvent("mouseover", { bubbles: true }),
			);
		});
		const hoverCall = trigger.mock.calls.find((c) => c[0] === "hover-link");
		expect(hoverCall).toBeTruthy();
		const payload = hoverCall![1] as Record<string, unknown>;
		expect(payload.linktext).toBe("Some Note");
		expect(payload.sourcePath).toBe(ACTIVE_PATH);
		expect(payload.targetEl).toBe(link);
	});
});

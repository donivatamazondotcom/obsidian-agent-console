/**
 * I176 — scroll fight during streaming from mid-render height collapse
 * (GH issue #251 / PR #252, reported by @fobban).
 *
 * During streaming, MarkdownRenderer's effect re-runs on every text chunk.
 * The pre-fix code called `el.empty()` synchronously, then repopulated the
 * container via the ASYNC `ObsidianMarkdownRenderer.render`. Between the two,
 * the container height collapsed to ~0 — the contentRef ResizeObserver in
 * use-auto-scroll-pin saw rapid shrink→grow oscillation and the pin logic
 * fought itself (violent jumping between top-of-response and bottom).
 *
 * The fix renders into a detached staging element and swaps children
 * atomically when the async render completes: the live container never
 * holds zero children mid-stream, so its height is monotonic.
 *
 * R1 (red-first): fails against the pre-fix MarkdownRenderer.tsx — the
 * "retains previous content while the next chunk render is in flight"
 * assertion sees an emptied container. Failing output cited in the I176
 * vault note.
 * R2 (boundary): enters via the public component API with re-renders on
 * `text`, exactly how ChatPanel drives it during streaming; the async
 * render boundary is a controllable promise on the mocked `obsidian`
 * module (declared architecture boundary).
 * R3 (outcome): asserts the DOM the user sees (container children),
 * not mock call counts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, act } from "@testing-library/react";

import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type AgentClientPlugin from "../../plugin";

// Controllable async render: each call gets its own deferred promise so the
// test decides when a given chunk's render "completes".
type Deferred = { resolve: () => void; el: HTMLElement; text: string };
const pendingRenders: Deferred[] = [];

vi.mock("obsidian", () => ({
	MarkdownRenderer: {
		render: vi.fn(
			(_app: unknown, text: string, el: HTMLElement) =>
				new Promise<void>((resolve) => {
					pendingRenders.push({
						el,
						text,
						resolve: () => {
							// Emulate the real renderer: populate the target
							// element, then settle.
							const p = el.ownerDocument.createElement("p");
							p.textContent = text;
							el.appendChild(p);
							resolve();
						},
					});
				}),
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
}));

// Obsidian augments HTMLElement with `empty()`; jsdom lacks it. Shim it so
// the pre-fix code path (`el.empty?.()`) actually clears the container in
// tests — without this the red run would silently no-op.
beforeEach(() => {
	pendingRenders.length = 0;
	if (typeof HTMLElement.prototype.empty !== "function") {
		HTMLElement.prototype.empty = function (this: HTMLElement) {
			while (this.firstChild) this.removeChild(this.firstChild);
		};
	}
});

function makePlugin(): AgentClientPlugin {
	return {
		app: {
			vault: { adapter: { getBasePath: () => "/mock/vault" } },
			metadataCache: {
				getFirstLinkpathDest: () => ({ path: "real/Target.md" }),
			},
			workspace: {
				openLinkText: vi.fn(),
				trigger: vi.fn(),
				getActiveFile: () => ({ path: "folder/Active Note.md" }),
			},
		},
		settings: { windowsWslMode: false },
	} as unknown as AgentClientPlugin;
}

function renderedTexts(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("p")).map(
		(p) => p.textContent ?? "",
	);
}

describe("I176 — streaming chunks must not collapse the rendered container", () => {
	it("retains previous content while the next chunk render is in flight, then swaps atomically", async () => {
		const plugin = makePlugin();

		// Chunk 1 arrives and its render completes.
		const view = await act(async () =>
			render(<MarkdownRenderer text="Hello" plugin={plugin} />),
		);
		expect(pendingRenders).toHaveLength(1);
		await act(async () => {
			pendingRenders[0].resolve();
		});
		expect(renderedTexts(view.container)).toEqual(["Hello"]);

		// Chunk 2 arrives — its async render is IN FLIGHT (not resolved yet).
		await act(async () => {
			view.rerender(<MarkdownRenderer text="Hello world" plugin={plugin} />);
		});
		expect(pendingRenders).toHaveLength(2);

		// THE core assertion (fails pre-fix): while chunk 2's render is in
		// flight, the container must still show chunk 1's content. The
		// pre-fix code emptied it synchronously, collapsing height to 0 and
		// feeding the scroll pin's ResizeObserver a shrink→grow oscillation.
		expect(renderedTexts(view.container)).toEqual(["Hello"]);

		// Chunk 2's render completes — atomic swap to the new content.
		await act(async () => {
			pendingRenders[1].resolve();
		});
		expect(renderedTexts(view.container)).toEqual(["Hello world"]);
	});

	it("never yields an empty container between consecutive chunk renders", async () => {
		const plugin = makePlugin();
		const view = await act(async () =>
			render(<MarkdownRenderer text="a" plugin={plugin} />),
		);
		await act(async () => {
			pendingRenders[0].resolve();
		});

		// Stream three more chunks; after the first successful render the
		// container must be non-empty at EVERY observable point.
		const chunks = ["ab", "abc", "abcd"];
		for (const chunk of chunks) {
			await act(async () => {
				view.rerender(<MarkdownRenderer text={chunk} plugin={plugin} />);
			});
			// In-flight: still non-empty (pre-fix: empty → height collapse).
			expect(
				view.container.querySelectorAll("p").length,
			).toBeGreaterThan(0);
			await act(async () => {
				pendingRenders[pendingRenders.length - 1].resolve();
			});
			expect(renderedTexts(view.container)).toEqual([chunk]);
		}
	});

	it("discards a superseded in-flight render (no duplicate content)", async () => {
		const plugin = makePlugin();
		const view = await act(async () =>
			render(<MarkdownRenderer text="one" plugin={plugin} />),
		);
		await act(async () => {
			pendingRenders[0].resolve();
		});

		// Two chunks arrive back-to-back; the first is superseded before its
		// render settles. Resolving it late must not clobber or duplicate.
		await act(async () => {
			view.rerender(<MarkdownRenderer text="two" plugin={plugin} />);
		});
		await act(async () => {
			view.rerender(<MarkdownRenderer text="three" plugin={plugin} />);
		});
		expect(pendingRenders).toHaveLength(3);

		await act(async () => {
			pendingRenders[1].resolve(); // superseded chunk settles late
			pendingRenders[2].resolve(); // current chunk settles
		});
		expect(renderedTexts(view.container)).toEqual(["three"]);
	});
});

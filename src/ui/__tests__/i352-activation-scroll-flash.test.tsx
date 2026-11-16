/**
 * I352: returning to a long chat flashed the middle of the transcript.
 *
 * Activation mounts every row and a new content element. Text blocks
 * render into a staging div and swap in on a microtask (I176), so the
 * pinned bottom written in the input task is the bottom of a transcript
 * with no text. The content ResizeObserver's first fire is the only write
 * that sees the full height, and it must land synchronously (in the
 * rendering update, before paint), not in a later task.
 *
 * Also pins the reading anchor refresh at unpin: a pinned tab can hold a
 * stale I284 anchor from a far scroll event, and an unpin that doesn't
 * save a new one would restore to it on the next return.
 *
 * Drives the real MessageList placeholder swap and the real
 * useAutoScrollPin hook. Bubbles render the real shared MarkdownRenderer
 * (staging swap), with Obsidian's renderer stubbed to fill the staging div
 * and resolve on a microtask. Geometry is stubbed because JSDOM has no
 * layout; the reset to 0 on hide mirrors Chromium under display:none.
 *
 * Timer model: real timers. The anchor tests never yield a macrotask
 * between steps, and they fire a content resize after the send, as
 * streaming does, so handleScroll's deferred setTimeout(1) bodies would
 * bail on the in-flight resize, or change nothing, even if they ran. Only the real-renderer
 * test awaits (for the staging swap), and nothing that changes scroll
 * state is queued before its awaits.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MarkdownRenderer as ObsidianMarkdownRenderer } from "obsidian";

import { MessageList } from "../MessageList";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";
import { makeMessageListPlugin } from "../../__test_stubs__/message-list-plugin";

vi.mock("../MessageBubble", async () => {
	const { MarkdownRenderer } = await vi.importActual<
		typeof import("../shared/MarkdownRenderer")
	>("../shared/MarkdownRenderer");
	return {
		MessageBubble: ({
			message,
			plugin,
		}: {
			message: ChatMessage;
			plugin: AgentClientPlugin;
		}) => {
			const first = message.content[0];
			const text = first && first.type === "text" ? first.text : "";
			return (
				<div data-testid="bubble">
					<MarkdownRenderer text={text} plugin={plugin} />
				</div>
			);
		},
	};
});

const mockPlugin = makeMessageListPlugin({
	app: {
		vault: { adapter: {} },
		workspace: { getActiveFile: () => null, openLinkText: vi.fn() },
	},
	settings: { windowsWslMode: false },
});
const mockView = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

const ROWS = 10;
const messages: ChatMessage[] = Array.from({ length: ROWS }, (_, i) => ({
	id: `m${i}`,
	role: i % 2 ? "assistant" : "user",
	content: [{ type: "text", text: `message ${i}` }],
	timestamp: new Date(0),
}));

const ROW_H = 500;
const PAD = 16;
const FULL = PAD * 2 + ROW_H * ROWS; // 5032
const TEXTLESS = 2000; // the transcript before any text block swaps in
const CLIENT = 600;
const bottomOf = (h: number, c = CLIENT) => h - c - 1;

const geom = { scrollTop: 0, scrollHeight: FULL, clientHeight: CLIENT };

// ResizeObserver: explicit fires, one instance per observed element set.
interface RoInstance {
	cb: ResizeObserverCallback;
	observed: Set<Element>;
	disconnected: boolean;
}
const roInstances: RoInstance[] = [];
class MockResizeObserver {
	private inst: RoInstance;
	constructor(cb: ResizeObserverCallback) {
		this.inst = { cb, observed: new Set(), disconnected: false };
		roInstances.push(this.inst);
	}
	observe(el: Element) {
		this.inst.observed.add(el);
	}
	unobserve(el: Element) {
		this.inst.observed.delete(el);
	}
	disconnect() {
		this.inst.observed.clear();
		this.inst.disconnected = true;
	}
}
function fireResize(el: Element, height: number) {
	for (const inst of roInstances) {
		if (inst.disconnected || !inst.observed.has(el)) continue;
		const entry = { target: el, contentRect: { height } } as unknown as ResizeObserverEntry;
		inst.cb([entry], inst as unknown as ResizeObserver);
	}
}

const proto = HTMLElement.prototype;
const origTop = Object.getOwnPropertyDescriptor(proto, "offsetTop");
const origHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
let originalRO: typeof globalThis.ResizeObserver | undefined;

beforeEach(() => {
	originalRO = globalThis.ResizeObserver;
	roInstances.length = 0;
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
	geom.scrollTop = 0;
	geom.scrollHeight = FULL;
	geom.clientHeight = CLIENT;
	(ObsidianMarkdownRenderer.render as Mock).mockImplementation(
		(_app: unknown, text: string, el: HTMLElement) => {
			const p = el.ownerDocument.createElement("p");
			p.textContent = text;
			el.appendChild(p);
			return Promise.resolve();
		},
	);
	const rowIndex = (el: HTMLElement) => {
		const id = el.getAttribute("data-message-id");
		return id ? Number(id.slice(1)) : -1;
	};
	Object.defineProperty(proto, "offsetTop", {
		configurable: true,
		get(this: HTMLElement) {
			const i = rowIndex(this);
			return i < 0 ? 0 : PAD + i * ROW_H;
		},
	});
	Object.defineProperty(proto, "offsetHeight", {
		configurable: true,
		get(this: HTMLElement) {
			return rowIndex(this) < 0 ? 0 : ROW_H;
		},
	});
});

afterEach(() => {
	// vitest globals are off, so Testing Library's auto-cleanup never runs.
	cleanup();
	if (originalRO) globalThis.ResizeObserver = originalRO;
	if (origTop) Object.defineProperty(proto, "offsetTop", origTop);
	if (origHeight) Object.defineProperty(proto, "offsetHeight", origHeight);
	(ObsidianMarkdownRenderer.render as Mock).mockReset();
});

function list(isActive: boolean, isSending = false) {
	return (
		<MessageList
			lastTurnEnd={null}
			messages={messages}
			isSending={isSending}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Claude"
			plugin={mockPlugin}
			view={mockView}
			hasActivePermission={false}
			isActive={isActive}
		/>
	);
}

function stubScroller(scrollEl: HTMLElement, height: () => number = () => geom.scrollHeight) {
	Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: height });
	Object.defineProperty(scrollEl, "clientHeight", { configurable: true, get: () => geom.clientHeight });
	Object.defineProperty(scrollEl, "scrollTop", {
		configurable: true,
		get: () => geom.scrollTop,
		set: (v: number) => {
			geom.scrollTop = Math.max(0, Math.min(v, height() - geom.clientHeight));
		},
	});
}

function mount(height?: () => number) {
	const utils = render(list(true));
	const scrollEl = utils.container.querySelector(
		".agent-client-chat-view-messages",
	) as HTMLDivElement;
	stubScroller(scrollEl, height);
	const content = () =>
		utils.container.querySelector(".agent-client-chat-content") as HTMLDivElement;
	return { ...utils, scrollEl, content };
}

/** Switch away: rows unmount, display:none resets the offset and heights. */
function hide(rerender: (ui: React.ReactElement) => void) {
	act(() => {
		rerender(list(false));
		geom.scrollTop = 0;
		geom.clientHeight = 0;
		geom.scrollHeight = 0;
	});
}

/** Switch back with the transcript at `height` (text not swapped in yet). */
function show(rerender: (ui: React.ReactElement) => void, height: number) {
	act(() => {
		geom.clientHeight = CLIENT;
		geom.scrollHeight = height;
		rerender(list(true));
	});
}

function scrollTo(scrollEl: HTMLElement, top: number) {
	act(() => {
		geom.scrollTop = top;
		scrollEl.dispatchEvent(new Event("scroll"));
	});
}

/**
 * The real source of a stale anchor on a pinned tab: the user reads at
 * 1000, then sends. The send pins the tab and smooth-scrolls down; its
 * intermediate scroll events save an anchor while pinned (m4, offset 484
 * at 2500), and its last event, within 70 px of the bottom, saves nothing.
 * Streaming starts, so a content resize is in flight.
 */
function armStaleAnchor(
	scrollEl: HTMLElement,
	content: () => HTMLElement,
	rerender: (ui: React.ReactElement) => void,
) {
	act(() => {
		scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
	});
	scrollTo(scrollEl, 1000);
	act(() => rerender(list(true, true)));
	act(() => fireResize(content(), FULL + 1));
	scrollTo(scrollEl, 2500);
	scrollTo(scrollEl, bottomOf(geom.scrollHeight, geom.clientHeight));
}

describe("I352: first content resize after activation lands at the bottom", () => {
	it("a pinned tab's first fire writes the full bottom synchronously", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));

		hide(rerender);
		show(rerender, TEXTLESS);
		expect(scrollEl).toBe(scrollEl.ownerDocument.querySelector(".agent-client-chat-view-messages"));
		// The input task's pinned write saw the text-less transcript.
		expect(geom.scrollTop).toBe(bottomOf(TEXTLESS));

		// Text swaps in; the new content element's first fire comes in the
		// rendering update, before paint.
		act(() => {
			geom.scrollHeight = FULL;
			fireResize(content(), FULL);
		});
		expect(geom.scrollTop).toBe(bottomOf(FULL));
	});

	it("with the real staging-swap renderer, lands at the bottom of the rendered text", async () => {
		const TOOL_H = 200;
		const TEXT_H = 300;
		const utils = render(list(true));
		const scrollElRef = utils.container.querySelector(
			".agent-client-chat-view-messages",
		) as HTMLElement;
		// Each row is a tool-call-sized block until its text swaps in.
		const height = () => {
			const c = scrollElRef.querySelector(".agent-client-chat-content");
			if (!c) return 0;
			const rows = c.querySelectorAll("[data-message-id]").length;
			const rendered = c.querySelectorAll(
				".agent-client-markdown-text-renderer.markdown-rendered",
			).length;
			return PAD * 2 + rows * TOOL_H + rendered * TEXT_H;
		};
		stubScroller(scrollElRef, height);
		const content = () =>
			utils.container.querySelector(".agent-client-chat-content") as HTMLDivElement;
		await act(async () => {
			await Promise.resolve();
		});
		act(() => fireResize(content(), height()));

		act(() => {
			utils.rerender(list(false));
			geom.scrollTop = 0;
			geom.clientHeight = 0;
		});
		act(() => {
			geom.clientHeight = CLIENT;
			utils.rerender(list(true));
		});
		// Rows are mounted, text blocks are still empty staging targets.
		expect(height()).toBe(PAD * 2 + ROWS * TOOL_H);
		expect(geom.scrollTop).toBe(bottomOf(PAD * 2 + ROWS * TOOL_H));

		// The swaps land on the microtask queue, before the rendering update.
		await act(async () => {
			await Promise.resolve();
		});
		const full = PAD * 2 + ROWS * (TOOL_H + TEXT_H);
		expect(height()).toBe(full);

		act(() => fireResize(content(), full));
		expect(geom.scrollTop).toBe(bottomOf(full));
	});

	it("a first fire at the text-less height, then the swap, stays at the bottom", () => {
		const { rerender, content } = mount();
		act(() => fireResize(content(), FULL));
		hide(rerender);
		show(rerender, TEXTLESS);

		act(() => fireResize(content(), TEXTLESS));
		expect(geom.scrollTop).toBe(bottomOf(TEXTLESS));

		act(() => {
			geom.scrollHeight = FULL;
			fireResize(content(), FULL);
		});
		expect(geom.scrollTop).toBe(bottomOf(FULL));
	});

	it("a wheel-up before the first fire keeps the user's place", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));
		hide(rerender);
		show(rerender, TEXTLESS);

		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
		});
		act(() => {
			geom.scrollHeight = FULL;
			fireResize(content(), FULL);
		});
		act(() => fireResize(content(), FULL + 100));
		// No bottom write after the unpin: not 0, not the full bottom.
		expect(geom.scrollTop).toBe(bottomOf(TEXTLESS));
	});

	it("a fresh mount with a transcript writes the bottom on the first fire", () => {
		const { content } = mount();
		act(() => fireResize(content(), FULL));
		expect(geom.scrollTop).toBe(bottomOf(FULL));
	});

	it("a scrolled-up tab still returns to its reading position (I284)", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));
		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
		});
		scrollTo(scrollEl, 1200);

		hide(rerender);
		show(rerender, TEXTLESS);
		act(() => {
			geom.scrollHeight = FULL;
			fireResize(content(), FULL);
		});
		expect(geom.scrollTop).toBe(1200);
	});
});

describe("I352: an unpin refreshes the reading anchor", () => {
	it("a scroll-key step under 70 px returns to where the key left the view", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));
		armStaleAnchor(scrollEl, content, rerender);

		// ArrowUp on the page, then one scroll event 40 px up (I304 unpin).
		act(() => {
			scrollEl.ownerDocument.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
			);
		});
		const afterKey = bottomOf(FULL) - 40;
		scrollTo(scrollEl, afterKey);

		hide(rerender);
		show(rerender, FULL);
		expect(geom.scrollTop).toBe(afterKey);
	});

	it("a wheel-up with no scroll event returns near the bottom", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));
		armStaleAnchor(scrollEl, content, rerender);

		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
		});

		hide(rerender);
		show(rerender, FULL);
		expect(geom.scrollTop).toBe(bottomOf(FULL));
	});

	it("an unpin with no message row in view anchors on the last row", () => {
		const { rerender, scrollEl, content } = mount();
		act(() => fireResize(content(), FULL));
		armStaleAnchor(scrollEl, content, rerender);

		// A short viewport at the very bottom: its top is below every row.
		act(() => {
			geom.clientHeight = 10;
			geom.scrollTop = bottomOf(FULL, 10);
		});
		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
		});

		hide(rerender);
		show(rerender, FULL);
		// Not the stale row (2500), not the top: the last row, clamped.
		expect(geom.scrollTop).toBe(bottomOf(FULL));
	});
});

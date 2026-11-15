/**
 * Jump to Start of Latest Reply — MessageList: U10-U13, U15, U16.
 *
 * Drives the real MessageList → useAutoScrollPin → MessageBubble path.
 * Outcomes are asserted on the DOM: where the scroll element lands, which
 * element holds focus, whether the up button renders, and the Notice.
 * JSDOM has no layout, so row positions, rects and scroll geometry are
 * stubbed per scroll element. IntersectionObserver is a controllable fake
 * whose disconnect() does NOT drop queued entries, like Chromium's.
 *
 * The one spy is a pass-through `vi.mock` of deriveReplyStartTarget, used
 * only to count MessageList renders (U16): behavior is unchanged.
 *
 * Spec: [[Jump to Start of Latest Reply]] § Behavior, § Mechanism, § Test cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		MarkdownRenderer: {
			render: vi.fn((_app: unknown, text: string, el: HTMLElement) => {
				el.textContent = text;
				return Promise.resolve();
			}),
		},
	};
});

vi.mock("../../resolvers/reply-start-target", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../resolvers/reply-start-target")>();
	return {
		...actual,
		deriveReplyStartTarget: vi.fn(actual.deriveReplyStartTarget),
	};
});

import { Notice } from "obsidian";
import { MessageList, type MessageListProps } from "../MessageList";
import { deriveReplyStartTarget } from "../../resolvers/reply-start-target";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import {
	makeIdleMcpAuthManager,
	makeMessageListPlugin,
	type TestWorkspace,
} from "../../__test_stubs__/message-list-plugin";

/** The obsidian stub's Notice records every notice shown (see __test_stubs__/obsidian.ts). */
const notices = Notice as unknown as { instances: Array<{ message: string | DocumentFragment }> };

const EVENT = "agent-console:jump-to-reply-start";
const NOTICE = "No reply to jump to yet";

// ----------------------------------------------------------------------------
// Fixtures: the store's real shape for "text, tool A, tool B, answer"
// (applyUpsertToolCall starts a message per tool call; text after tool B
// joins its message).
// ----------------------------------------------------------------------------
const user = (id: string, text: string): ChatMessage => ({
	id,
	role: "user",
	content: [{ type: "text", text }],
	timestamp: new Date(0),
});
const tool = (id: string) =>
	({ type: "tool_call", toolCallId: id, title: id, status: "completed" }) as const;

const MESSAGES: ChatMessage[] = [
	user("u1", "Question"),
	{ id: "a1", role: "assistant", content: [{ type: "text", text: "Let me check." }], timestamp: new Date(0) },
	{ id: "a2", role: "assistant", content: [tool("A")], timestamp: new Date(0) },
	{ id: "a3", role: "assistant", content: [tool("B"), { type: "text", text: "Final answer." }], timestamp: new Date(0) },
];

// ----------------------------------------------------------------------------
// Geometry, per scroll element
// ----------------------------------------------------------------------------
interface Geom {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	rowTops: Record<string, number>;
	textOffset: number;
}
const geoms = new WeakMap<Element, Geom>();
const defaultRowTops = { u1: 16, a1: 216, a2: 1016, a3: 1046, u2: 1600, a4: 1700 };

function scrollerOf(el: Element): HTMLElement | null {
	return el.closest(".agent-client-chat-view-messages");
}

/** Attach stubbed geometry to a rendered list's scroll element. */
function attachGeometry(container: Element, patch: Partial<Geom> = {}): { scrollEl: HTMLElement; geom: Geom } {
	const scrollEl = container.querySelector(".agent-client-chat-view-messages") as HTMLElement;
	const geom: Geom = {
		scrollTop: 4399,
		scrollHeight: 5000,
		clientHeight: 600,
		rowTops: { ...defaultRowTops },
		textOffset: 30,
		...patch,
	};
	geoms.set(scrollEl, geom);
	Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => geom.scrollHeight });
	Object.defineProperty(scrollEl, "clientHeight", { configurable: true, get: () => geom.clientHeight });
	Object.defineProperty(scrollEl, "scrollTop", {
		configurable: true,
		get: () => geom.scrollTop,
		set: (v: number) => {
			geom.scrollTop = v;
		},
	});
	return { scrollEl, geom };
}

function rowTopOf(el: HTMLElement): number {
	const row = el.closest("[data-message-id]") as HTMLElement | null;
	const scroller = scrollerOf(el);
	const g = scroller ? geoms.get(scroller) : undefined;
	if (!row || !g) return 0;
	return g.rowTops[row.dataset.messageId ?? ""] ?? 0;
}

const proto = HTMLElement.prototype;
const origOffsetTop = Object.getOwnPropertyDescriptor(proto, "offsetTop");

// ----------------------------------------------------------------------------
// IntersectionObserver fake
// ----------------------------------------------------------------------------
class FakeIO {
	static instances: FakeIO[] = [];
	observed: Element[] = [];
	disconnected = false;
	constructor(
		private cb: IntersectionObserverCallback,
		public options?: IntersectionObserverInit,
	) {
		FakeIO.instances.push(this);
	}
	observe(el: Element) {
		this.observed.push(el);
	}
	unobserve() {}
	disconnect() {
		this.disconnected = true;
	}
	takeRecords() {
		return [];
	}
	/** Deliver an entry. Works after disconnect(), like a queued entry. */
	report(isIntersecting: boolean) {
		const entry = { isIntersecting, target: this.observed[0] } as unknown as IntersectionObserverEntry;
		act(() => {
			this.cb([entry], this as unknown as IntersectionObserver);
		});
	}
}
const lastIO = () => FakeIO.instances[FakeIO.instances.length - 1];

let workspace: TestWorkspace;
let plugin: ReturnType<typeof makeMessageListPlugin>;
const view = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

beforeEach(() => {
	(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	FakeIO.instances = [];
	(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
	notices.instances = [];
	plugin = makeMessageListPlugin({
		settings: { displaySettings: { showEmojis: false } },
		mcpAuthManager: makeIdleMcpAuthManager(),
		app: { vault: { adapter: {} } },
	});
	workspace = (plugin.app as unknown as { workspace: TestWorkspace }).workspace;
	// MarkdownRenderer resolves links against the active file.
	(workspace as unknown as { getActiveFile: () => null }).getActiveFile = () => null;

	Object.defineProperty(proto, "offsetTop", {
		configurable: true,
		get(this: HTMLElement) {
			return this.dataset.messageId ? rowTopOf(this) : 0;
		},
	});
	vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		const scroller = scrollerOf(this);
		const g = scroller ? geoms.get(scroller) : undefined;
		let top = 0;
		if (g && this !== scroller) {
			if (this.dataset.messageId) top = rowTopOf(this) - g.scrollTop;
			else if (this.hasAttribute("data-reply-text-start")) top = rowTopOf(this) + g.textOffset - g.scrollTop;
		}
		return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
	});
	vi.mocked(deriveReplyStartTarget).mockClear();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (origOffsetTop) Object.defineProperty(proto, "offsetTop", origOffsetTop);
	else delete (proto as unknown as { offsetTop?: unknown }).offsetTop;
});

function List(props: Partial<MessageListProps>) {
	return (
		<MessageList
			messages={MESSAGES}
			isSending={false}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Kiro"
			plugin={plugin}
			view={view}
			hasActivePermission={false}
			isActive
			viewId="tab-a"
			{...props}
		/>
	);
}

const upButton = (root: Element) => root.querySelector(".agent-client-jump-to-reply-start");
const textStart = (root: Element, id: string) =>
	root.querySelector(`[data-message-id="${id}"] > .agent-client-message-renderer > [data-reply-text-start]`) as HTMLElement;
const tick = () =>
	act(async () => {
		await new Promise((r) => window.setTimeout(r, 5));
	});

// ============================================================================
// U10 — visibility
// ============================================================================
describe("Jump to start of reply button: visibility (U10)", () => {
	it("is hidden while sending, and no observer is created until the turn ends", () => {
		const { container, rerender } = render(<List isSending />);
		expect(FakeIO.instances).toHaveLength(0);
		expect(upButton(container)).toBeNull();
		rerender(<List />);
		expect(FakeIO.instances).toHaveLength(1);
	});

	it("is hidden while the session is being acquired, and no observer is created until it's ready", () => {
		const { container, rerender } = render(<List lazyState="connecting" />);
		expect(FakeIO.instances).toHaveLength(0);
		expect(upButton(container)).toBeNull();
		rerender(<List lazyState="ready" />);
		expect(FakeIO.instances).toHaveLength(1);
	});

	it("observes the final answer's text with a half-plane root above the list; shows when above, hides when not", () => {
		const { container } = render(<List />);
		const scrollEl = container.querySelector(".agent-client-chat-view-messages");
		expect(FakeIO.instances).toHaveLength(1);
		const io = lastIO();
		expect(io.options?.root).toBe(scrollEl);
		expect(io.options?.rootMargin).toBe("100000px 0px -100% 0px");
		expect(io.options?.threshold).toBe(0);
		expect(io.observed).toEqual([textStart(container, "a3")]);
		expect(upButton(container)).toBeNull();

		io.report(true);
		const btn = upButton(container);
		expect(btn).not.toBeNull();
		expect(btn?.tagName).toBe("BUTTON");
		expect(btn?.getAttribute("aria-label")).toBe("Jump to start of reply");

		io.report(false);
		expect(upButton(container)).toBeNull();
	});

	it("a stale 'above' doesn't carry over a send to a new, short target", () => {
		const { container, rerender } = render(<List />);
		lastIO().report(true);
		expect(upButton(container)).not.toBeNull();

		rerender(<List isSending />);
		expect(upButton(container)).toBeNull();

		const next: ChatMessage[] = [
			...MESSAGES,
			user("u2", "Short one?"),
			{ id: "a4", role: "assistant", content: [{ type: "text", text: "Yes." }], timestamp: new Date(0) },
		];
		rerender(<List messages={next} />);
		expect(upButton(container)).toBeNull();
		expect(lastIO().observed).toEqual([textStart(container, "a4")]);
	});

	it("a stale 'above' doesn't carry over a tab switch for the same target", () => {
		const { container, rerender } = render(<List />);
		lastIO().report(true);
		expect(upButton(container)).not.toBeNull();
		rerender(<List isActive={false} />);
		rerender(<List isActive />);
		expect(upButton(container)).toBeNull();
	});

	it("a stale 'above' doesn't carry over a send-and-finish with the transcript unchanged", () => {
		const { container, rerender } = render(<List />);
		lastIO().report(true);
		rerender(<List isSending />);
		rerender(<List />);
		expect(upButton(container)).toBeNull();
	});

	it("a late callback from a disconnected observer can't override the new observation", () => {
		const { container, rerender } = render(<List />);
		const oldIO = lastIO();
		rerender(<List isSending />);
		rerender(<List />);
		const newIO = lastIO();
		expect(newIO).not.toBe(oldIO);
		expect(oldIO.disconnected).toBe(true);
		newIO.report(false);
		oldIO.report(true); // queued entry delivered after disconnect()
		expect(upButton(container)).toBeNull();
		newIO.report(true);
		expect(upButton(container)).not.toBeNull();
	});
});

// ============================================================================
// U15 — session replay
// ============================================================================
describe("Jump to start of reply button: session replay (U15)", () => {
	it("messages growing while connecting create no observer and show no button", () => {
		const { container, rerender } = render(<List messages={MESSAGES.slice(0, 1)} lazyState="connecting" />);
		rerender(<List messages={MESSAGES.slice(0, 2)} lazyState="connecting" />);
		rerender(<List messages={MESSAGES.slice(0, 3)} lazyState="connecting" />);
		rerender(<List messages={MESSAGES} lazyState="connecting" />);
		expect(FakeIO.instances).toHaveLength(0);
		expect(upButton(container)).toBeNull();
		// Once connected, the final target is observed exactly once.
		rerender(<List messages={MESSAGES} lazyState="ready" />);
		expect(FakeIO.instances).toHaveLength(1);
		expect(lastIO().observed).toEqual([textStart(container, "a3")]);
	});
});

// ============================================================================
// U11 — what a click does
// ============================================================================
describe("Jump to start of reply button: click (U11)", () => {
	it("a pointer click jumps to the final answer's text, 8 px below the top, and unpins", () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		lastIO().report(true);
		const btn = upButton(container) as HTMLElement;
		expect(fireEvent.mouseDown(btn)).toBe(false); // default prevented: focus stays put
		fireEvent.click(btn, { detail: 1 });
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
		const down = container.querySelector(".agent-client-scroll-to-bottom");
		expect(down).not.toBeNull();
		expect(down?.getAttribute("aria-label")).toBe("Jump to latest");
	});

	it("falls back to the row when the text element is missing", () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		lastIO().report(true);
		textStart(container, "a3").removeAttribute("data-reply-text-start");
		fireEvent.click(upButton(container) as HTMLElement, { detail: 1 });
		expect(geom.scrollTop).toBe(1046 - 8);
	});
});

// ============================================================================
// U12 — focus
// ============================================================================
describe("Jump to start of reply button: focus (U12)", () => {
	it("keyboard activation jumps, moves focus to the target without scrolling, and the tabindex goes on blur", () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		lastIO().report(true);
		const target = textStart(container, "a3");
		const focusSpy = vi.spyOn(proto, "focus");
		fireEvent.click(upButton(container) as HTMLElement, { detail: 0 });
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
		const call = focusSpy.mock.calls.findIndex((_c, i) => focusSpy.mock.contexts[i] === target);
		expect(call).toBeGreaterThanOrEqual(0);
		expect(focusSpy.mock.calls[call][0]).toEqual({ preventScroll: true });
		expect(document.activeElement).toBe(target);
		expect(target.getAttribute("tabindex")).toBe("-1");
		act(() => {
			target.blur();
		});
		expect(target.hasAttribute("tabindex")).toBe(false);
	});

	it("a mouse click on a button Tab had focused takes the keyboard path (review L2)", () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		lastIO().report(true);
		const btn = upButton(container) as HTMLElement;
		btn.focus();
		expect(document.activeElement).toBe(btn);
		fireEvent.mouseDown(btn);
		fireEvent.click(btn, { detail: 1 });
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
		expect(document.activeElement).toBe(textStart(container, "a3"));
	});

	it("a pointer press on the down pill has its default prevented, so the pill never takes focus (review L1)", () => {
		const { container } = render(<List />);
		attachGeometry(container);
		lastIO().report(true);
		fireEvent.click(upButton(container) as HTMLElement, { detail: 1 });
		const down = container.querySelector(".agent-client-scroll-to-bottom") as HTMLElement;
		expect(fireEvent.mouseDown(down)).toBe(false);
	});

	it("a pointer click leaves focus where it was", () => {
		const { container } = render(
			<div>
				<textarea data-testid="composer" />
				<List />
			</div>,
		);
		attachGeometry(container);
		lastIO().report(true);
		const composer = container.querySelector("textarea") as HTMLTextAreaElement;
		composer.focus();
		const target = textStart(container, "a3");
		const focusSpy = vi.spyOn(proto, "focus");
		fireEvent.mouseDown(upButton(container) as HTMLElement);
		fireEvent.click(upButton(container) as HTMLElement, { detail: 1 });
		expect(focusSpy.mock.contexts).not.toContain(target);
		expect(document.activeElement).toBe(composer);
		expect(target.hasAttribute("tabindex")).toBe(false);
	});
});

// ============================================================================
// U13 — the command
// ============================================================================
describe("Jump to start of latest reply command (U13)", () => {
	it("registers one listener and jumps on a matching view id after a 0 ms timer", async () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		expect(workspace.listenerCount(EVENT)).toBe(1);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		expect(geom.scrollTop).toBe(4399); // deferred, not yet
		await tick();
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
		expect(notices.instances).toHaveLength(0);
	});

	it("ignores another view's id", async () => {
		const { container } = render(<List />);
		const { geom } = attachGeometry(container);
		act(() => {
			workspace.trigger(EVENT, "tab-b");
		});
		await tick();
		expect(geom.scrollTop).toBe(4399);
		expect(notices.instances).toHaveLength(0);
		// Positive control: this view's id does jump.
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
	});

	it("a tab switch before the timer fires cancels the jump", async () => {
		const { container, rerender } = render(<List />);
		const { geom } = attachGeometry(container);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		rerender(<List isActive={false} />);
		await tick();
		expect(geom.scrollTop).toBe(4399);
		expect(notices.instances).toHaveLength(0);
		// Positive control: back on the tab, the command works again.
		rerender(<List isActive />);
		const again = attachGeometry(container);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(again.geom.scrollTop).toBe(1046 + 30 - 8);
	});

	it("with no reply yet shows a Notice", async () => {
		const { container } = render(<List messages={MESSAGES.slice(0, 1)} />);
		const { geom } = attachGeometry(container);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(geom.scrollTop).toBe(4399);
		expect(notices.instances.map((entry) => String(entry.message))).toEqual([
			expect.stringContaining(NOTICE),
		]);
	});

	it("with an empty transcript shows a Notice", async () => {
		render(<List messages={[]} />);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(notices.instances.map((entry) => String(entry.message))).toEqual([
			expect.stringContaining(NOTICE),
		]);
	});

	it("looks up the target in this tab only, never another list with the same row ids", async () => {
		// B renders first in document order, so a document-wide query would hit it.
		const { container } = render(
			<div>
				<div className="list-b">
					<List viewId="tab-b" />
				</div>
				<div className="list-a">
					<List viewId="tab-a" />
				</div>
			</div>,
		);
		const b = attachGeometry(container.querySelector(".list-b") as Element, {
			rowTops: { ...defaultRowTops, a3: 2046 },
		});
		const a = attachGeometry(container.querySelector(".list-a") as Element);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(a.geom.scrollTop).toBe(1046 + 30 - 8);
		expect(b.geom.scrollTop).toBe(4399);
	});

	it("works while the agent is still writing", async () => {
		const streaming: ChatMessage[] = [
			user("u1", "Question"),
			{ id: "a1", role: "assistant", content: [{ type: "text", text: "Streaming…" }], timestamp: new Date(0) },
		];
		const { container } = render(<List messages={streaming} isSending />);
		const { geom } = attachGeometry(container);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		await tick();
		expect(geom.scrollTop).toBe(216 + 30 - 8);
		expect(notices.instances).toHaveLength(0);
	});

	it("clears the pending timer and removes the listener on unmount", async () => {
		const { container, unmount } = render(<List messages={MESSAGES.slice(0, 1)} />);
		attachGeometry(container);
		expect(workspace.listenerCount(EVENT)).toBe(1);
		act(() => {
			workspace.trigger(EVENT, "tab-a");
		});
		unmount();
		await tick();
		expect(notices.instances).toHaveLength(0);
		expect(workspace.listenerCount(EVENT)).toBe(0);
	});
});

// ============================================================================
// U16 — observer reports don't re-render MessageList
// ============================================================================
describe("Jump to start of reply button: render cost (U16)", () => {
	it("an observer report toggling the button doesn't re-render MessageList", () => {
		const { container } = render(<List />);
		const renders = vi.mocked(deriveReplyStartTarget).mock.calls.length;
		expect(renders).toBeGreaterThan(0);
		lastIO().report(true);
		expect(upButton(container)).not.toBeNull();
		lastIO().report(false);
		expect(upButton(container)).toBeNull();
		expect(vi.mocked(deriveReplyStartTarget).mock.calls.length).toBe(renders);
	});
});

// ============================================================================
// U17 (regression guard) — the content element keeps its DOM node across
// empty ↔ populated, so the hook's content ResizeObserver is never rebuilt.
// Passes on main; driven red once by rendering the anchor in the populated
// branch only (recorded in the feature's Txx note).
// ============================================================================
describe("Content element identity across empty and populated (U17)", () => {
	it("keeps the same .agent-client-chat-content node for [] → one message → []", () => {
		const { container, rerender } = render(<List messages={[]} />);
		const first = container.querySelector(".agent-client-chat-content");
		expect(first).not.toBeNull();
		rerender(<List messages={MESSAGES.slice(0, 1)} />);
		expect(container.querySelector(".agent-client-chat-content")).toBe(first);
		rerender(<List messages={[]} />);
		expect(container.querySelector(".agent-client-chat-content")).toBe(first);
	});
});

// ============================================================================
// With Chat Timestamps (PR 2): stamps render, the target stays the answer
// ============================================================================
describe("Jump to start of reply with chat timestamps", () => {
	it("keyboard activation on a gap-stamped answer lands on the group that starts with its stamp", () => {
		const T = Date.UTC(2026, 10, 15, 17, 0);
		const stamped: ChatMessage[] = [
			{ ...user("u1", "Question"), sentAt: T, turnEndedAt: T + 600_000, turnEndKind: "done", turnMs: 600_000 },
			MESSAGES[1],
			MESSAGES[2],
			{
				id: "a3",
				role: "assistant",
				content: [
					tool("B"),
					{ type: "text", text: "Final answer.", arrivedAt: T + 500_000, gapBefore: true },
				],
				timestamp: new Date(0),
			},
		];
		const { container } = render(<List messages={stamped} />);
		const { geom } = attachGeometry(container);
		lastIO().report(true);
		const target = textStart(container, "a3");
		expect(lastIO().observed).toEqual([target]);
		expect(target.firstElementChild?.classList.contains("agent-client-stamp-gap")).toBe(true);
		fireEvent.click(upButton(container) as HTMLElement, { detail: 0 });
		expect(geom.scrollTop).toBe(1046 + 30 - 8);
		expect(document.activeElement).toBe(target);
		// The prompt and end stamps render around it without becoming the target.
		expect(container.querySelector('[data-message-id="u1"] .agent-client-stamp-prompt')).not.toBeNull();
		expect(container.querySelector('[data-message-id="a3"] > .agent-client-stamp-end')).not.toBeNull();
	});
});

/**
 * I357: the scroll-anchoring attribute survives a tab switch.
 *
 * Inactive tabs render an empty placeholder in the same scroll element, so
 * the attribute set on unpin must stay on that element through the swap,
 * and the I284 restore must still land at the reading position with native
 * anchoring on. Drives the real MessageList and the real hook; geometry is
 * stubbed because JSDOM has no layout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import { SCROLL_ANCHORING_ATTR } from "../use-auto-scroll-pin.types";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import { makeMessageListPlugin } from "../../__test_stubs__/message-list-plugin";

vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: ChatMessage }) => (
		<div data-testid="bubble">{message.id}</div>
	),
}));

const mockPlugin = makeMessageListPlugin();
const mockView = { registerDomEvent: vi.fn() } as unknown as IChatViewHost;

const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
	id: `m${i}`,
	role: i % 2 ? "assistant" : "user",
	content: [{ type: "text", text: `message ${i}` }],
	timestamp: new Date(0),
}));

const ROW_H = 500;
const PAD = 16;
const geom = { scrollTop: 0, scrollHeight: PAD * 2 + ROW_H * 10, clientHeight: 600 };

const proto = HTMLElement.prototype;
const origTop = Object.getOwnPropertyDescriptor(proto, "offsetTop");
const origHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
let originalRO: typeof globalThis.ResizeObserver | undefined;

beforeEach(() => {
	originalRO = globalThis.ResizeObserver;
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	geom.scrollTop = 0;
	geom.scrollHeight = PAD * 2 + ROW_H * 10;
	geom.clientHeight = 600;
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
});

function list(isActive: boolean) {
	return (
		<MessageList
			lastTurnEnd={null}
			messages={messages}
			isSending={false}
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

describe("I357: scroll anchoring across a tab switch", () => {
	it("keeps the attribute on the scroller through the placeholder swap, and I284 still restores", async () => {
		const { container, rerender } = render(list(true));
		const scrollEl = container.querySelector(".agent-client-chat-view-messages") as HTMLDivElement;
		Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => geom.scrollHeight });
		Object.defineProperty(scrollEl, "clientHeight", { configurable: true, get: () => geom.clientHeight });
		Object.defineProperty(scrollEl, "scrollTop", {
			configurable: true,
			get: () => geom.scrollTop,
			set: (v: number) => {
				geom.scrollTop = v;
			},
		});
		expect(scrollEl.hasAttribute(SCROLL_ANCHORING_ATTR)).toBe(false);

		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
			geom.scrollTop = 1200;
			scrollEl.dispatchEvent(new Event("scroll"));
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5));
		});
		expect(scrollEl.hasAttribute(SCROLL_ANCHORING_ATTR)).toBe(true);

		act(() => {
			rerender(list(false));
			geom.scrollTop = 0;
			geom.clientHeight = 0;
		});
		expect(container.querySelector(".agent-client-chat-view-messages")).toBe(scrollEl);
		expect(scrollEl.hasAttribute(SCROLL_ANCHORING_ATTR)).toBe(true);

		act(() => {
			geom.clientHeight = 600;
			rerender(list(true));
		});
		expect(scrollEl.hasAttribute(SCROLL_ANCHORING_ATTR)).toBe(true);
		expect(geom.scrollTop).toBe(1200);
	});
});

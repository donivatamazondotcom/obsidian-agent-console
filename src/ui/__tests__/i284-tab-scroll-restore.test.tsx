/**
 * I284: returning to a scrolled-up tab restores the reading position.
 *
 * Drives the real MessageList placeholder swap (inactive tabs render an
 * empty scroll div, so every row unmounts) through the real
 * useAutoScrollPin hook. Row and container geometry are stubbed because
 * JSDOM has no layout; the reset to 0 on hide mirrors what Chromium does
 * under display:none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import type { ChatMessage } from "../../types/chat";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: ({ message }: { message: ChatMessage }) => (
		<div data-testid="bubble">{message.id}</div>
	),
}));

const mockPlugin = {} as unknown as AgentClientPlugin;
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

beforeEach(() => {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
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
	if (origTop) Object.defineProperty(proto, "offsetTop", origTop);
	if (origHeight) Object.defineProperty(proto, "offsetHeight", origHeight);
});

function list(isActive: boolean) {
	return (
		<MessageList
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

describe("I284: MessageList tab return", () => {
	it("restores the reading position after the inactive placeholder swap", async () => {
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

		// User scrolls up to 1200.
		act(() => {
			scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
			geom.scrollTop = 1200;
			scrollEl.dispatchEvent(new Event("scroll"));
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 5));
		});

		// Switch away: rows unmount, display:none resets the offset.
		act(() => {
			rerender(list(false));
			geom.scrollTop = 0;
			geom.clientHeight = 0;
		});
		expect(container.querySelectorAll("[data-message-id]").length).toBe(0);

		// Switch back.
		act(() => {
			geom.clientHeight = 600;
			rerender(list(true));
		});
		expect(container.querySelector(".agent-client-chat-view-messages")).toBe(scrollEl);
		expect(geom.scrollTop).toBe(1200);
	});
});

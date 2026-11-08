/**
 * I302 §4: a Default Kiro tab that fell back to V2 on an old kiro-cli shows a
 * tip at the top of the chat saying what V3 gives after `kiro-cli update`.
 * "Got it" hides it for this install (a settings flag), in every open tab.
 *
 * Seams (R2): the pure `deriveKiroUpdateTip`, and the real MessageList in
 * both branches (empty chat and conversation) with a settings store that
 * behaves like `SettingsService` (subscribe / getSnapshot / updateSettings).
 * Assertions are on rendered text and the written flag (R3). Obsidian and
 * MessageBubble stubs only (R4). Literal expectations (R5).
 *
 * Red-first (R1): on main there is no tip and no resolver.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { MessageList } from "../MessageList";
import { deriveKiroUpdateTip } from "../../resolvers/kiro-update-tip";
import type { IChatViewHost } from "../view-host";
import type AgentClientPlugin from "../../plugin";
import type { ChatMessage } from "../../types/chat";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock("obsidian", () => ({
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	MarkdownRenderer: { render: vi.fn() },
	Component: class {},
	Platform: { isMobile: false },
}));

vi.mock("../MessageBubble", () => ({
	MessageBubble: () => <div data-testid="bubble" />,
}));

/** A settings store with SettingsService's contract: new snapshot per write. */
function makeStore(dismissed = false) {
	let state: Record<string, unknown> = { kiroV3UpdateTipDismissed: dismissed, other: 0 };
	const listeners = new Set<() => void>();
	const store = {
		subscribe: (l: () => void) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		getSnapshot: () => state,
		updateSettings: vi.fn(async (u: Record<string, unknown>) => {
			state = { ...state, ...u };
			listeners.forEach((l) => l());
		}),
	};
	return store;
}

function renderList(
	store: ReturnType<typeof makeStore>,
	fallback: "old-cli" | undefined,
	messages: ChatMessage[] = [],
) {
	return render(
		<MessageList
			messages={messages}
			isSending={false}
			lazyState="ready"
			isRestoringSession={false}
			agentLabel="Auto SA"
			kiroEngineFallback={fallback}
			plugin={{ settingsService: store } as unknown as AgentClientPlugin}
			view={{ registerDomEvent: vi.fn() } as unknown as IChatViewHost}
			hasActivePermission={false}
		/>,
	);
}

const msg: ChatMessage = {
	id: "m1",
	role: "user",
	content: [{ type: "text", text: "hi" }],
	timestamp: new Date("2026-11-08T10:00:00Z"),
};

const tipOf = (c: HTMLElement) => c.querySelector(".agent-client-kiro-update-tip");

describe("I302 deriveKiroUpdateTip", () => {
	it("shows only for a fallback tab that hasn't been dismissed", () => {
		expect(deriveKiroUpdateTip({ fallback: "old-cli", dismissed: false })).toEqual({
			kind: "show",
		});
		expect(deriveKiroUpdateTip({ fallback: "old-cli", dismissed: true })).toEqual({
			kind: "hidden",
		});
		expect(deriveKiroUpdateTip({ fallback: undefined, dismissed: false })).toEqual({
			kind: "hidden",
		});
	});
});

describe("I302 update tip in the chat", () => {
	it("empty chat on a fallback tab: the tip names the agent and the update command", () => {
		const { container } = renderList(makeStore(), "old-cli");
		const tip = tipOf(container);
		expect(tip).not.toBeNull();
		const text = tip?.textContent ?? "";
		expect(text).toContain("This chat runs on Kiro CLI V2");
		expect(text).toContain("Auto SA runs on V2 here");
		expect(tip?.querySelector("code")?.textContent).toBe("kiro-cli update");
		expect(tip?.querySelectorAll("li")).toHaveLength(5);
		expect(text).toContain("hooks");
	});

	it("conversation on a fallback tab shows it too", () => {
		const { container } = renderList(makeStore(), "old-cli", [msg]);
		expect(tipOf(container)).not.toBeNull();
	});

	it("no tip without a fallback, or once dismissed", () => {
		expect(tipOf(renderList(makeStore(), undefined).container)).toBeNull();
		expect(tipOf(renderList(makeStore(true), "old-cli").container)).toBeNull();
	});

	it("Got it is a native button that hides the tip in every open tab", async () => {
		const store = makeStore();
		const a = renderList(store, "old-cli");
		const b = renderList(store, "old-cli", [msg]);
		const button = tipOf(a.container)?.querySelector("button");
		expect(button?.tagName).toBe("BUTTON");
		expect(button?.textContent).toBe("Got it");
		await act(async () => {
			fireEvent.click(button as HTMLButtonElement);
		});
		expect(store.updateSettings).toHaveBeenCalledWith({ kiroV3UpdateTipDismissed: true });
		expect(tipOf(a.container)).toBeNull();
		expect(tipOf(b.container)).toBeNull();
	});

	it("an unrelated settings write doesn't re-render the tip", async () => {
		const store = makeStore();
		let renders = 0;
		const Probe = React.Profiler;
		render(
			<Probe id="tip" onRender={() => renders++}>
				<MessageList
					messages={[]}
					isSending={false}
					lazyState="ready"
					isRestoringSession={false}
					agentLabel="Auto SA"
					kiroEngineFallback="old-cli"
					plugin={{ settingsService: store } as unknown as AgentClientPlugin}
					view={{ registerDomEvent: vi.fn() } as unknown as IChatViewHost}
					hasActivePermission={false}
				/>
			</Probe>,
		);
		const before = renders;
		await act(async () => {
			await store.updateSettings({ other: 1 });
		});
		expect(renders).toBe(before);
	});
});

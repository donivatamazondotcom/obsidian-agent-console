/**
 * I301 code review B1 — Delete on the focused ACTIVE rail key.
 *
 * Closing the active tab activates its neighbor, and the neighbor's composer
 * focuses itself on activation (InputArea's I19 effect, a setTimeout(0)). That
 * used to win over the rail's own focus move, so focus left the rail and a
 * second Backspace deleted a character of the next chat's draft. Drives the
 * real TabRail and a real InputArea per tab, with real timers.
 *
 * Guards: a mouse switch (click a key) still focuses the composer, and a ×
 * click on the active tab still lands in the new active composer.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import * as React from "react";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, setIcon: vi.fn(), setTooltip: vi.fn() };
});
vi.mock("../keyboard-focus", () => ({ isKeyboardFocus: () => false }));

import { TabRail, type RailSettingsStore } from "../TabRail";
import { InputArea, type InputAreaProps } from "../InputArea";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "../view-host";
import type { UseSuggestionsReturn } from "../../hooks/useSuggestions";
import type { TabInfo } from "../../types/tab";

// Like Chromium's IntersectionObserver: observe() reports the element's
// visibility asynchronously. A tab's composer is hidden (display:none) while
// the tab is inactive, so activation makes InputArea's I26 effect see it turn
// visible and refocus it – the second activation-refocus path (smoke A7).
const hidden = (el: Element | null): boolean => {
	for (let e = el as HTMLElement | null; e; e = e.parentElement)
		if (e.style?.display === "none") return true;
	return false;
};
beforeAll(() => {
	class IO {
		private dead = false;
		constructor(private cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
		observe(el: Element) {
			window.setTimeout(() => {
				if (!this.dead) this.cb([{ isIntersecting: !hidden(el) }]);
			}, 5);
		}
		unobserve() {}
		disconnect() {
			this.dead = true;
		}
	}
	(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});
// The rail measures its parent to decide icons vs names; give the view 1000px.
beforeEach(() => {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		const w = this.classList.contains("test-view") ? 1000 : 0;
		return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: w, width: w, height: 0, toJSON: () => ({}) } as DOMRect;
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const settingsSnapshot = { sendMessageShortcut: "enter" };
const plugin = {
	settings: { displaySettings: { showEmojis: false } },
	settingsService: { subscribe: () => () => {}, getSnapshot: () => settingsSnapshot },
	app: { vault: { getConfig: () => true } },
} as unknown as AgentClientPlugin;
const closed = {
	isOpen: false,
	suggestions: [] as unknown[],
	selectedIndex: 0,
	createRow: null,
	updateSuggestions: () => undefined,
	close: () => undefined,
	selectSuggestion: (v: string) => ({ newText: v, newCursorPos: v.length }),
};
const suggestions = {
	mentions: closed,
	commands: closed,
	quickPrompts: closed,
	activePicker: null,
} as unknown as UseSuggestionsReturn;

function composerProps(isActive: boolean, draft: string): InputAreaProps {
	return {
		isSending: false,
		isSessionReady: true,
		lazyState: "ready",
		isRestoringSession: false,
		agentLabel: "Kiro",
		availableCommands: [],
		restoredMessage: null,
		suggestions,
		plugin,
		view: {} as IChatViewHost,
		onSendMessage: vi.fn(async () => undefined),
		onStopGeneration: vi.fn(async () => undefined),
		onRestoredMessageConsumed: () => undefined,
		supportsImages: false,
		imageCapabilityKnown: true,
		agentId: "kiro-cli",
		inputValue: draft,
		onInputChange: () => undefined,
		attachedFiles: [],
		onAttachedFilesChange: () => undefined,
		errorInfo: null,
		onClearError: () => undefined,
		agentUpdateNotification: null,
		onClearAgentUpdate: () => undefined,
		messages: [],
		isActive,
	} as InputAreaProps;
}

const tab = (id: string): TabInfo => ({
	tabId: id,
	agentId: "kiro-cli",
	origin: "fresh",
	label: `Chat ${id}`,
	state: "ready",
	createdAt: new Date(0),
});

const store: RailSettingsStore = {
	subscribe: () => () => {},
	getSnapshot: () => ({ tabRailWidth: 160, tabRailNamedWidth: 160 }),
	updateSettings: () => undefined,
};

/** ChatView in miniature: the rail plus one mounted composer per tab (inactive ones hidden). */
function View() {
	const [s, setS] = React.useState({ tabs: ["a", "b", "c"].map(tab), active: "b" });
	const close = (id: string) =>
		setS((p) => {
			const i = p.tabs.findIndex((t) => t.tabId === id);
			const next = p.tabs.filter((t) => t.tabId !== id);
			const active = id === p.active ? (next[Math.min(i, next.length - 1)]?.tabId ?? "") : p.active;
			return { tabs: next, active };
		});
	return (
		<div className="test-view">
			{s.tabs.map((t) => (
				<div key={t.tabId} data-panel={t.tabId} style={{ display: t.tabId === s.active ? undefined : "none" }}>
					<InputArea {...composerProps(t.tabId === s.active, `draft ${t.tabId}`)} />
				</div>
			))}
			<TabRail
				tabs={s.tabs}
				activeTabId={s.active}
				onSelectTab={(id) => setS((p) => ({ ...p, active: id }))}
				onAddTab={() => undefined}
				onCloseTab={close}
				onCloseOtherTabs={() => undefined}
				onCloseTabsToRight={() => undefined}
				onRenameTab={() => undefined}
				onMoveTab={() => undefined}
				settingsStore={store}
			/>
		</div>
	);
}

const settle = () =>
	act(async () => {
		await new Promise((r) => window.setTimeout(r, 20));
	});
const keys = (c: HTMLElement) =>
	Array.from(c.querySelectorAll<HTMLButtonElement>(".agent-client-tab-rail-key"));
const composer = (c: HTMLElement, id: string) =>
	c.querySelector<HTMLTextAreaElement>(`[data-panel="${id}"] textarea`);

describe("I301 B1 – Delete on the active rail key keeps focus on the rail", () => {
	it("focus stays on the key now at that position, not the new active composer", async () => {
		const { container } = render(<View />);
		await settle();
		keys(container)[1].focus(); // the active key, "b"
		fireEvent.keyDown(keys(container)[1], { key: "Backspace" });
		await settle();
		expect(keys(container).map((k) => k.dataset.tabId)).toEqual(["a", "c"]);
		expect(document.activeElement).toBe(keys(container)[1]);
		expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
	});

	it("two quick Deletes on the active key keep focus on the rail", async () => {
		const { container } = render(<View />);
		await settle();
		keys(container)[1].focus(); // active "b"
		fireEvent.keyDown(keys(container)[1], { key: "Delete" });
		// "c" is now active and focused; close it before any refocus timer runs.
		fireEvent.keyDown(document.activeElement!, { key: "Delete" });
		await settle();
		expect(keys(container).map((k) => k.dataset.tabId)).toEqual(["a"]);
		expect(document.activeElement).toBe(keys(container)[0]);
	});

	it("the hold lapses: a later mouse switch still focuses the composer", async () => {
		const { container } = render(<View />);
		await settle();
		keys(container)[1].focus();
		fireEvent.keyDown(keys(container)[1], { key: "Delete" });
		await act(async () => {
			await new Promise((r) => window.setTimeout(r, 300));
		});
		fireEvent.click(keys(container)[0]); // switch to "a" with the mouse
		await settle();
		expect(document.activeElement).toBe(composer(container, "a"));
	});

	it("a × click on the active tab lands in the new active composer", async () => {
		const { container } = render(<View />);
		await settle();
		composer(container, "b")!.focus();
		fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".agent-client-tab-rail-close")[1]);
		await settle();
		expect(document.activeElement).toBe(composer(container, "c"));
	});
});

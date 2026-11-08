/**
 * I300: the "What's new" card.
 *
 * Driven against the real settings store (`SettingsService`) with only the
 * plugin's save port faked, so the card's subscriptions, writes and render
 * counts are the ones the running plugin gets.
 *
 * - Try / Switch back writes `tabDisplay` and the label follows the setting,
 *   across a remount and across two mounted cards.
 * - Dismiss writes `max(lastSeen, current)` once, clears forced mode, and
 *   hides every card at once.
 * - The card renders 0 times on writes it doesn't read.
 * - Invalid manifest version → no card; a rejected write is caught and logged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { render, act, fireEvent } from "@testing-library/react";
import { SettingsService } from "../../services/settings-service";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import type AgentClientPlugin from "../../plugin";
import type { AgentClientPluginSettings } from "../../plugin";
import { WhatsNewCard } from "../WhatsNewCard";
import { createWhatsNewForcedStore } from "../../whats-new/forced-store";

type Saves = AgentClientPluginSettings[];

function makeStore(
	init: Partial<AgentClientPluginSettings>,
	opts: { failSave?: boolean } = {},
) {
	const saves: Saves = [];
	const settings = { ...DEFAULT_SETTINGS, ...init };
	const plugin = {
		settings,
		saveSettings: vi.fn(async () => {
			if (opts.failSave) throw new Error("disk full");
			saves.push(structuredClone(plugin.settings));
		}),
		getLiveSessionIds: () => [],
	};
	const service = new SettingsService(
		settings,
		plugin as unknown as AgentClientPlugin,
	);
	const spy = vi.spyOn(service, "updateSettings");
	return { service, spy, saves };
}

function card(
	service: SettingsService,
	forced = createWhatsNewForcedStore(),
	version = "2.5.0",
) {
	return (
		<WhatsNewCard
			settingsStore={service}
			forcedStore={forced}
			currentVersion={version}
		/>
	);
}

const region = (c: HTMLElement) => c.querySelector('[role="region"]');
const actionButton = (c: HTMLElement) =>
	c.querySelector<HTMLButtonElement>(".agent-client-whats-new-action");
const dismissButton = (c: HTMLElement) =>
	c.querySelector<HTMLButtonElement>(".agent-client-whats-new-dismiss");

afterEach(() => vi.restoreAllMocks());

describe("I300 WhatsNewCard toggle", () => {
	it("Try vertical tabs → vertical, then Switch back → horizontal", async () => {
		const { service, spy } = makeStore({ tabDisplay: "horizontal" });
		const { container } = render(card(service));
		expect(region(container)).not.toBeNull();
		expect(actionButton(container)!.textContent).toBe("Try vertical tabs");

		await act(async () => fireEvent.click(actionButton(container)!));
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenLastCalledWith({ tabDisplay: "vertical" });
		expect(service.getSnapshot().tabDisplay).toBe("vertical");
		expect(actionButton(container)!.textContent).toBe(
			"Switch back to top tabs",
		);

		await act(async () => fireEvent.click(actionButton(container)!));
		expect(spy).toHaveBeenLastCalledWith({ tabDisplay: "horizontal" });
		// Taking the action doesn't dismiss.
		expect(region(container)).not.toBeNull();
	});

	it("a remount with vertical tabs (reload after Try) still says Switch back", () => {
		const { service } = makeStore({ tabDisplay: "vertical" });
		const { container } = render(card(service));
		expect(actionButton(container)!.textContent).toBe(
			"Switch back to top tabs",
		);
	});

	it("Try in one card flips the label in a second card on the same store", async () => {
		const { service } = makeStore({ tabDisplay: "horizontal" });
		const forced = createWhatsNewForcedStore();
		const a = render(card(service, forced));
		const b = render(card(service, forced));
		await act(async () => fireEvent.click(actionButton(a.container)!));
		expect(actionButton(b.container)!.textContent).toBe(
			"Switch back to top tabs",
		);
	});
});

describe("I300 WhatsNewCard dismiss", () => {
	it("writes lastSeenVersion once, clears forced, hides both cards", async () => {
		const { service, spy, saves } = makeStore({ lastSeenVersion: "2.5.0" });
		const forced = createWhatsNewForcedStore();
		act(() => forced.set(true));
		const a = render(card(service, forced));
		const b = render(card(service, forced));
		expect(region(a.container)).not.toBeNull();
		expect(region(b.container)).not.toBeNull();

		await act(async () => fireEvent.click(dismissButton(a.container)!));
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith({ lastSeenVersion: "2.5.0" });
		expect(forced.get()).toBe(false);
		expect(region(a.container)).toBeNull();
		expect(region(b.container)).toBeNull();
		expect(saves[saves.length - 1].lastSeenVersion).toBe("2.5.0");
	});

	it("an existing user's dismiss stores the current version", async () => {
		const { service, spy } = makeStore({});
		const { container } = render(card(service));
		await act(async () => fireEvent.click(dismissButton(container)!));
		expect(spy).toHaveBeenCalledWith({ lastSeenVersion: "2.5.0" });
		expect(region(container)).toBeNull();
	});

	it("dismiss after a downgrade keeps the higher stored version (6c)", async () => {
		const { service, spy } = makeStore({ lastSeenVersion: "2.6.0" });
		const forced = createWhatsNewForcedStore();
		act(() => forced.set(true));
		const { container } = render(card(service, forced, "2.5.0"));
		await act(async () => fireEvent.click(dismissButton(container)!));
		expect(spy).toHaveBeenCalledWith({ lastSeenVersion: "2.6.0" });
	});

	it("a rejected write is caught and logged, not thrown (6c)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			const { service } = makeStore({}, { failSave: true });
			const { container } = render(card(service));
			await act(async () => fireEvent.click(actionButton(container)!));
			await act(async () => fireEvent.click(dismissButton(container)!));
			await new Promise((r) => setTimeout(r, 0));
			expect(unhandled).not.toHaveBeenCalled();
			expect(
				warn.mock.calls.filter((c) =>
					c.some((a) => String(a).includes("What's new")),
				).length,
			).toBe(2);
			// The in-memory write still landed, so the card stays hidden.
			expect(region(container)).toBeNull();
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});
});

describe("I300 WhatsNewCard guards", () => {
	it("an invalid manifest version → no card and no write (6c)", () => {
		const { service, spy } = makeStore({});
		const { container } = render(card(service, undefined, "garbage"));
		expect(region(container)).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it("no card when this version is already dismissed", () => {
		const { service } = makeStore({ lastSeenVersion: "2.5.0" });
		const { container } = render(card(service));
		expect(region(container)).toBeNull();
	});

	it("is a labelled region with native controls, no auto-focus", () => {
		const { service } = makeStore({});
		const { container } = render(card(service));
		const r = region(container)!;
		const headingId = r.getAttribute("aria-labelledby")!;
		expect(document.getElementById(headingId)!.textContent).toBe(
			"What's new in Agent Console",
		);
		expect(actionButton(container)!.tagName).toBe("BUTTON");
		expect(dismissButton(container)!.tagName).toBe("BUTTON");
		expect(dismissButton(container)!.getAttribute("aria-label")).toBe(
			"Dismiss",
		);
		const link = container.querySelector<HTMLAnchorElement>(
			".agent-client-whats-new-link",
		)!;
		expect(link.getAttribute("href")).toBe(
			"https://github.com/donivatamazondotcom/obsidian-agent-console/releases/tag/2.5.0",
		);
		expect(r.contains(document.activeElement)).toBe(false);
		// Only the icon-only dismiss carries aria-label (Obsidian tooltips).
		expect(r.querySelectorAll("[aria-label]")).toHaveLength(1);
	});
});

describe("I300 WhatsNewCard render cost (6a)", () => {
	it("renders 0 times on a savedSessions write and a tabRailWidth write", async () => {
		const { service } = makeStore({});
		let renders = 0;
		const onRender = () => {
			renders++;
		};
		render(
			<React.Profiler id="card" onRender={onRender}>
				{card(service)}
			</React.Profiler>,
		);
		renders = 0;
		await act(async () => {
			await service.updateSettings({
				savedSessions: [...service.getSnapshot().savedSessions],
			});
		});
		await act(async () => {
			await service.updateSettings({ tabRailWidth: 150 });
		});
		expect(renders).toBe(0);
	});
});

describe("I300 keyboard dismiss returns focus (review F2)", () => {
	it("calls onDismissed when focus was in the card", async () => {
		const { service } = makeStore({});
		const onDismissed = vi.fn();
		const { container } = render(
			<WhatsNewCard
				settingsStore={service}
				forcedStore={createWhatsNewForcedStore()}
				currentVersion="2.5.0"
				onDismissed={onDismissed}
			/>,
		);
		dismissButton(container)!.focus();
		await act(async () => fireEvent.click(dismissButton(container)!));
		expect(region(container)).toBeNull();
		expect(onDismissed).toHaveBeenCalledTimes(1);
	});

	it("doesn't call onDismissed when focus wasn't in the card (e.g. a jsdom click without focus; in Obsidian a mouse click focuses the button, so it refocuses too)", async () => {
		const { service } = makeStore({});
		const onDismissed = vi.fn();
		const { container } = render(
			<WhatsNewCard
				settingsStore={service}
				forcedStore={createWhatsNewForcedStore()}
				currentVersion="2.5.0"
				onDismissed={onDismissed}
			/>,
		);
		(document.activeElement as HTMLElement | null)?.blur();
		await act(async () => fireEvent.click(dismissButton(container)!));
		expect(onDismissed).not.toHaveBeenCalled();
	});
});

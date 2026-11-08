/**
 * I300: the card's placement in ChatView, and the "Show what's new" command.
 *
 * No test mounts the real ChatComponent (see draft-persistence-tab-switch
 * test), so `ChatViewShape` reproduces the part that matters here: hooks
 * above a zero-tab early return, the card on the landing, and the card in
 * `TabsLayout`'s notice slot otherwise. A source check pins that ChatView
 * itself calls the hook above its early return (the repo has no
 * react-hooks lint rule to catch a move).
 *
 * - 6b: the notice element is the same reference across parent re-renders,
 *   and landing → tab → landing keeps the hook count stable.
 * - 7: showing/hiding the card and switching tabDisplay never remount a panel.
 * - 8: the command re-shows a hidden card (also on the landing), forced mode
 *   with vertical tabs still renders the entry, and an empty registry opens
 *   the release notes instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, act, fireEvent } from "@testing-library/react";
import { SettingsService } from "../../services/settings-service";
import { DEFAULT_SETTINGS } from "../../services/settings-normalizer";
import type AgentClientPlugin from "../../plugin";
import type { AgentClientPluginSettings } from "../../plugin";
import { TabsLayout, useTabDisplay } from "../TabsLayout";
import { useWhatsNewNotice } from "../WhatsNewCard";
import { createWhatsNewForcedStore } from "../../whats-new/forced-store";
import { showWhatsNew } from "../../whats-new/show-whats-new";

function makeHost(init: Partial<AgentClientPluginSettings>, version = "2.5.0") {
	const settings = { ...DEFAULT_SETTINGS, ...init };
	const plugin = {
		settings,
		saveSettings: vi.fn(async () => {}),
		getLiveSessionIds: () => [],
	};
	const settingsService = new SettingsService(
		settings,
		plugin as unknown as AgentClientPlugin,
	);
	return {
		settingsService,
		whatsNewForced: createWhatsNewForcedStore(),
		manifest: { version },
	};
}
type Host = ReturnType<typeof makeHost>;

let panelMounts = 0;
function Panel() {
	React.useEffect(() => {
		panelMounts++;
	}, []);
	return <div className="panel">panel</div>;
}

const notices: React.ReactElement[] = [];
function ChatViewShape({ host, tabs }: { host: Host; tabs: string[] }) {
	const tabDisplay = useTabDisplay(host.settingsService);
	const notice = useWhatsNewNotice(host);
	notices.push(notice);
	if (tabs.length === 0) {
		return <div className="landing">{notice}</div>;
	}
	return (
		<TabsLayout
			tabDisplay={tabDisplay}
			strip={<div className="strip" />}
			rail={<div className="rail" />}
			notice={notice}
		>
			{tabs.map((t) => (
				<div key={t} className="agent-client-tab-panel">
					<Panel />
				</div>
			))}
		</TabsLayout>
	);
}

const cardIn = (c: ParentNode) => c.querySelector('[role="region"]');
afterEach(() => vi.restoreAllMocks());

describe("I300 useWhatsNewNotice placement (6b)", () => {
	it("returns the same element across parent re-renders", () => {
		const host = makeHost({});
		notices.length = 0;
		const { rerender } = render(<ChatViewShape host={host} tabs={["a"]} />);
		rerender(<ChatViewShape host={host} tabs={["a", "b"]} />);
		rerender(<ChatViewShape host={host} tabs={["b", "a"]} />);
		expect(notices.length).toBeGreaterThanOrEqual(3);
		expect(new Set(notices).size).toBe(1);
	});

	it("landing → open a tab → close the last tab → landing keeps the card", () => {
		const host = makeHost({});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const { container, rerender } = render(
			<ChatViewShape host={host} tabs={[]} />,
		);
		expect(cardIn(container.querySelector(".landing")!)).not.toBeNull();
		rerender(<ChatViewShape host={host} tabs={["a"]} />);
		expect(
			cardIn(container.querySelector(".agent-client-tab-panels")!),
		).not.toBeNull();
		rerender(<ChatViewShape host={host} tabs={[]} />);
		expect(cardIn(container.querySelector(".landing")!)).not.toBeNull();
		expect(err).not.toHaveBeenCalled();
	});

	it("ChatView calls useWhatsNewNotice above its zero-tab early return", () => {
		const src = readFileSync(resolve(__dirname, "../ChatView.tsx"), "utf8");
		const hook = src.indexOf("useWhatsNewNotice(plugin)");
		const early = src.indexOf("if (tabs.length === 0) {");
		expect(hook).toBeGreaterThan(-1);
		expect(early).toBeGreaterThan(-1);
		expect(hook).toBeLessThan(early);
	});
});

describe("I300 TabsLayout notice slot (7)", () => {
	it("renders the card once, before the panels, inside the panels wrapper", () => {
		const host = makeHost({});
		const { container } = render(
			<ChatViewShape host={host} tabs={["a", "b", "c"]} />,
		);
		const wrapper = container.querySelector(".agent-client-tab-panels")!;
		expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
		expect(wrapper.firstElementChild!.getAttribute("role")).toBe("region");
	});

	it("dismiss and a display switch don't remount a panel", async () => {
		const host = makeHost({ tabDisplay: "horizontal" });
		panelMounts = 0;
		const { container } = render(
			<ChatViewShape host={host} tabs={["a", "b"]} />,
		);
		expect(panelMounts).toBe(2);
		await act(async () =>
			fireEvent.click(
				container.querySelector(".agent-client-whats-new-action")!,
			),
		);
		expect(container.querySelector(".rail")).not.toBeNull();
		await act(async () =>
			fireEvent.click(
				container.querySelector(".agent-client-whats-new-dismiss")!,
			),
		);
		expect(cardIn(container)).toBeNull();
		act(() => host.whatsNewForced.set(true));
		expect(cardIn(container)).not.toBeNull();
		await act(async () => {
			await host.settingsService.updateSettings({
				tabDisplay: "horizontal",
			});
		});
		expect(panelMounts).toBe(2);
	});
});

describe("I300 Show what's new command (8)", () => {
	function deps(
		host: Host,
		extra: Partial<Parameters<typeof showWhatsNew>[0]> = {},
	) {
		return {
			currentVersion: host.manifest.version,
			lastSeen: host.settingsService.getSnapshot().lastSeenVersion,
			forcedStore: host.whatsNewForced,
			activateView: vi.fn(async () => {}),
			openUrl: vi.fn(),
			...extra,
		};
	}

	it("re-shows a card hidden by an earlier dismiss and reveals the view", async () => {
		const host = makeHost({ lastSeenVersion: "2.5.0" });
		const { container } = render(
			<ChatViewShape host={host} tabs={["a"]} />,
		);
		expect(cardIn(container)).toBeNull();
		const d = deps(host);
		await act(async () => showWhatsNew(d));
		expect(cardIn(container)).not.toBeNull();
		expect(d.activateView).toHaveBeenCalledTimes(1);
		expect(d.openUrl).not.toHaveBeenCalled();
	});

	it("forced with vertical tabs renders the entry, labelled Switch back", async () => {
		const host = makeHost({
			lastSeenVersion: "2.5.0",
			tabDisplay: "vertical",
		});
		const { container } = render(
			<ChatViewShape host={host} tabs={["a"]} />,
		);
		await act(async () => showWhatsNew(deps(host)));
		expect(
			container.querySelector(".agent-client-whats-new-action")!
				.textContent,
		).toBe("Switch back to top tabs");
	});

	it("works from the zero-tab landing", async () => {
		const host = makeHost({ lastSeenVersion: "2.5.0" });
		const { container } = render(<ChatViewShape host={host} tabs={[]} />);
		await act(async () => showWhatsNew(deps(host)));
		expect(cardIn(container.querySelector(".landing")!)).not.toBeNull();
	});

	it("with nothing to show, opens the release notes instead", async () => {
		const host = makeHost({ lastSeenVersion: "2.5.0" });
		const d = deps(host, { highlights: [] });
		await act(async () => showWhatsNew(d));
		expect(d.openUrl).toHaveBeenCalledWith(
			"https://github.com/donivatamazondotcom/obsidian-agent-console/releases/tag/2.5.0",
		);
		expect(host.whatsNewForced.get()).toBe(false);
		expect(d.activateView).not.toHaveBeenCalled();
	});
});

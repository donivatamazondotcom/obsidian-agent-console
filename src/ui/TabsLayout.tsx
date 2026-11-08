/**
 * Where the chat view puts its tab surface ([[Agent Console Vertical Tab
 * Rail]] § Layout).
 *
 * One root element in both modes; only a class changes. Fixed slots:
 * `[strip?] [panels] [rail?]`, with the panels in a keyed wrapper (an
 * optional notice sits first inside it), so
 * switching the setting swaps strip ↔ rail without remounting (or moving) a
 * tab panel – a remount would tear down the tab's agent session.
 */
import * as React from "react";
const { useSyncExternalStore } = React;
import type { TabDisplay } from "../plugin";

interface TabDisplayStore {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => { tabDisplay: TabDisplay };
}

/**
 * Subscribe to `tabDisplay` only. Returns a primitive, so writes to any other
 * setting (per-turn session saves, rail width commits) don't re-render the
 * caller – ChatView, whose panels aren't memoized.
 */
export function useTabDisplay(store: TabDisplayStore): TabDisplay {
	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().tabDisplay,
		() => store.getSnapshot().tabDisplay,
	);
}

export function TabsLayout({
	tabDisplay,
	strip,
	rail,
	notice,
	children,
}: {
	tabDisplay: TabDisplay;
	strip: React.ReactNode;
	rail: React.ReactNode;
	/**
	 * Shown once above the panels (the "What's new" card, I300). A sibling
	 * before `children`, not part of the keyed panel list, so showing or
	 * hiding it never remounts a panel.
	 */
	notice?: React.ReactNode;
	children: React.ReactNode;
}) {
	const vertical = tabDisplay === "vertical";
	return (
		<div
			className={`agent-client-tabs-layout ${vertical ? "is-vertical" : "is-horizontal"}`}
		>
			{!vertical && strip}
			<div key="panels" className="agent-client-tab-panels">
				{notice}
				{children}
			</div>
			{vertical && rail}
		</div>
	);
}

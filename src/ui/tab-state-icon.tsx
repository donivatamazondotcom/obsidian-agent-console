/**
 * Tab state icons, shared by the tab strip, the chevron tab list and the
 * vertical tab rail. One leaf module so `TabBar.tsx` and `tab-menus.ts` can
 * both import it without a cycle. `TabBar.tsx` re-exports everything here.
 */

import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type { TabState } from "../types/tab";
import { t } from "../i18n";

/**
 * Maps a tab state to its colorblind-safe Lucide icon id.
 *
 * Single source of truth shared by the strip's {@link TabStateIcon} and the
 * chevron dropdown (handleChevronClick, which builds its own span in the row
 * title). Paired with {@link stateIconClass} so both surfaces share shape,
 * color and animation (I278). Shape is the primary signal by design — see
 * `types/tab.ts`. I238: Lucide icons replace Unicode glyphs, which depended on
 * the loaded font and read poorly at small sizes.
 */
export function stateIcon(state: TabState): string {
	switch (state) {
		case "ready":
			return "circle-dot";
		case "busy":
			return "loader-circle";
		case "permission":
			return "triangle-alert";
		case "error":
			return "circle-x";
		case "disconnected":
			return "circle";
		case "released":
			// I209: asleep to save memory. A moon reads as "asleep" and is a distinct
			// shape from disconnected, so the two differ without relying on color.
			// I238: chosen in the smoke test over circle-pause.
			return "moon";
		// Tab Attention States: finished / stopped early while you weren't
		// looking, and a dashed ring while the agent starts.
		case "doneUnseen":
			// A bare tick, no ring: the ring made it read like the ready dot at
			// tab-strip size (smoke H1, 2026-11-01).
			return "check";
		case "stoppedUnseen":
			return "circle-alert";
		case "connecting":
			return "circle-dashed";
	}
}

/**
 * Class string for a tab state icon: the base class plus the per-state class
 * that carries color and animation (styles.css § Tab State Icons). Pure, so
 * the strip can keep React as the only owner of its span's classes while the
 * dropdown builds its own span with the same classes (I278).
 */
export function stateIconClass(state: TabState): string {
	return `agent-client-tab-state-icon agent-client-tab-state-${state}`;
}

/**
 * Hover label for each tab state ([[Tab Attention States]]). Every state
 * explains itself; Obsidian shows `aria-label` as the tooltip.
 */
export function stateLabel(state: TabState): string {
	switch (state) {
		case "ready":
			return t("chat.tabBar.state.ready");
		case "busy":
			return t("chat.tabBar.state.busy");
		case "permission":
			return t("chat.tabBar.state.permission");
		case "error":
			return t("chat.tabBar.state.error");
		case "disconnected":
			return t("chat.tabBar.state.disconnected");
		case "released":
			return t("chat.tabBar.asleepToSaveMemory");
		case "connecting":
			return t("chat.tabBar.state.connecting");
		case "doneUnseen":
			return t("chat.tabBar.state.doneUnseen");
		case "stoppedUnseen":
			return t("chat.tabBar.state.stoppedUnseen");
	}
}

/**
 * Renders a tab state icon using shape + color + animation.
 * No red/green contrast dependency.
 */
export function TabStateIcon({
	state,
	decorative = false,
}: {
	state: TabState;
	/**
	 * Vertical tab rail: the key carries the state in its accessible name and
	 * must have no `aria-label` inside it (Obsidian shows any aria-label as a
	 * hover tooltip, which would double the flyout). Hidden from screen
	 * readers, no label, no role.
	 */
	decorative?: boolean;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const icon = stateIcon(state);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, icon);
	}, [icon]);
	const className = stateIconClass(state);
	if (decorative) {
		return <span ref={ref} className={className} aria-hidden="true" />;
	}
	// Obsidian shows aria-label as the hover tooltip.
	const label = stateLabel(state);
	return (
		<span ref={ref} className={className} aria-label={label} role="img" />
	);
}

import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { Menu, setIcon } from "obsidian";
import { registerOpenMenu, showMenuAtEvent } from "../utils/menu-registry";
import type { SharedLink } from "../utils/link-extract";
import { t } from "../i18n";

// ============================================================================
// Props
// ============================================================================

export interface SharedLinksButtonProps {
	/** Deduped, recency-ordered links the agent shared in the active tab. */
	links: SharedLink[];
	/** Open a chosen link; the originating DOM event carries open-in-new-tab modifiers. */
	onOpenLink: (link: SharedLink, evt: MouseEvent | KeyboardEvent) => void;
}

// ============================================================================
// SharedLinksButton
// ============================================================================

/**
 * Header indicator that aggregates every link the agent has shared in the
 * active tab (see [[Shared Links Bubble]] spec). Sits left of the reload button
 * in the header's nav-buttons-container.
 *
 * Behavior:
 *   - Lucide `link` icon with a macOS-app-icon-style count badge showing the
 *     total unique-link count. The badge gets an accent when >=1 link points at
 *     a file the agent created this session.
 *   - ALWAYS rendered; greyed/disabled (non-clickable) when there are zero
 *     links, so it never appears/disappears (spec D3).
 *   - Click opens an Obsidian `Menu` popover grouped into "New this session" and
 *     "Earlier". The new/old distinction is conveyed by grouping + section
 *     labels (NOT color) — colorblind-safe per user-profile.md.
 *
 * Uses Obsidian's sanctioned `Menu` API (registered via menu-registry so a
 * plugin reload never orphans an open popup) rather than a hand-rolled popover.
 */
export function SharedLinksButton({ links, onOpenLink }: SharedLinksButtonProps) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (iconRef.current) setIcon(iconRef.current, "link");
	}, []);

	const count = links.length;
	const newCount = links.reduce((n, l) => (l.isNew ? n + 1 : n), 0);
	const disabled = count === 0;

	const buildMenu = useCallback((): Menu => {
		const menu = new Menu();

		const newLinks = links.filter((l) => l.isNew);
		const oldLinks = links.filter((l) => !l.isNew);

		const addLinkItem = (link: SharedLink) => {
			menu.addItem((item) => {
				item.setTitle(link.label);
				item.onClick((evt) => onOpenLink(link, evt));
			});
		};

		// New (agent-created this session) links float to the top, divided from
		// the rest by a bare separator — but ONLY when there are both new and
		// old links to distinguish. When nothing is classified new (agents that
		// don't emit a create signal, or a turn with no creates), the list
		// renders flat with no divider, so it never shows a confusing empty
		// "Earlier" framing. The divide is conveyed by position + separator,
		// never color (colorblind-safe per user-profile.md).
		if (newLinks.length > 0 && oldLinks.length > 0) {
			newLinks.forEach(addLinkItem);
			menu.addSeparator();
			oldLinks.forEach(addLinkItem);
		} else {
			links.forEach(addLinkItem);
		}

		registerOpenMenu(menu);
		return menu;
	}, [links, onOpenLink]);

	// Single handler for both mouse and keyboard activation; showMenuAtEvent
	// anchors to the button rect for keyboard activation (no cursor) and to the
	// cursor for real mouse clicks (I115).
	const openMenu = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			if (links.length === 0) return;
			const menu = buildMenu();
			showMenuAtEvent(menu, e);
		},
		[links.length, buildMenu],
	);

	return (
		<button
			type="button"
			className={
				"clickable-icon nav-action-button acp-shared-links-button" +
				(disabled ? " acp-shared-links-button--disabled" : "")
			}
			// Native <button> matching the sibling reload/history/save/more nav
			// buttons: individually Tab-focusable, Enter/Space activation, and
			// Obsidian's clickable-icon :focus-visible ring — identical focus
			// behavior to its siblings. `disabled` takes it out of the tab order
			// at zero links. See SLB-I7.
			disabled={disabled}
			aria-label={
				disabled
					? t("chat.sharedLinks.none")
					: newCount > 0
						? t("chat.sharedLinks.countWithNew", {
								count,
								new: newCount,
							})
						: t("chat.sharedLinks.count", { count })
			}
			onClick={openMenu}
		>
			<span ref={iconRef} className="acp-shared-links-icon" />
			{count > 0 && (
				<span
					className={
						"acp-shared-links-badge" +
						(newCount > 0 ? " acp-shared-links-badge--accent" : "")
					}
				>
					{count}
				</span>
			)}
		</button>
	);
}

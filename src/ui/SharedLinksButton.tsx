import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { Menu, setIcon } from "obsidian";
import { registerOpenMenu } from "../utils/menu-registry";
import type { SharedLink } from "../utils/link-extract";

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

	const showMenuAtMouse = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (links.length === 0) return;
			buildMenu().showAtMouseEvent(e.nativeEvent);
		},
		[links.length, buildMenu],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (links.length === 0) return;
			if (e.key !== "Enter" && e.key !== " ") return;
			e.preventDefault();
			// No mouse coords on keyboard activation — anchor the menu to the
			// button's bottom-left via its bounding rect.
			const rect = e.currentTarget.getBoundingClientRect();
			buildMenu().showAtPosition({ x: rect.left, y: rect.bottom });
		},
		[links.length, buildMenu],
	);

	return (
		<div
			className={
				"clickable-icon nav-action-button acp-shared-links-button" +
				(disabled ? " acp-shared-links-button--disabled" : "")
			}
			role="button"
			tabIndex={disabled ? -1 : 0}
			aria-label={
				disabled
					? "No shared links yet"
					: `Shared links (${count}${newCount > 0 ? `, ${newCount} new` : ""})`
			}
			aria-disabled={disabled}
			onClick={disabled ? undefined : showMenuAtMouse}
			onKeyDown={disabled ? undefined : handleKeyDown}
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
		</div>
	);
}

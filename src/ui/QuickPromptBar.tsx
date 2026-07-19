/**
 * QuickPromptBar — the ephemeral contextual chips row above the composer.
 *
 * Renders **nothing** when no prompts match the active note (empty = no row,
 * vertical space reclaimed). Each chip fires its prompt on click / Enter /
 * Space; holding ⇧ or ⌥ inserts instead. A current-tab chip is disabled in
 * place while a message is queued (lock glyph + reduced opacity —
 * color-vision-safe, no red/green); a `newTab` chip stays live (and shows a
 * `↩` marker). Disabled chips use `aria-disabled` + a banner-linked tooltip so
 * they explain why rather than reading as inert (keyboard-first rule).
 *
 * The prompt set passed in is already matched to the active note
 * (`matchPromptsForNote`); the disabled state is a derived render-time
 * predicate (`quickPromptButtonDisabled`), never a captured flag, so it stays
 * correct as the matched set changes on editor-tab switches.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Three surfaces / § Cross-Feature Interactions.
 */

import * as React from "react";
const { useRef, useEffect, useState, useLayoutEffect } = React;
import { setIcon } from "obsidian";
import type { QuickPrompt } from "../types/quick-prompt";
import {
	quickPromptButtonDisabled,
	capRestingChips,
} from "../services/quick-prompts-logic";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import { quickPromptGestureFromEvent } from "../utils/quick-prompt-gesture";
import { MOD_KEY, ALT_KEY, SHIFT_KEY } from "../utils/platform";
import { t } from "../i18n";

/** Tooltip on a disabled current-tab chip — points at the queued banner. */
export function queuedChipTooltip(): string {
	return t("chat.quickPrompts.queuedTooltip");
}

/**
 * Guidance tooltips enumerating the modifier matrix (plain language). Set as
 * the chip's `aria-label` so Obsidian renders its own themed tooltip (the
 * sanctioned mechanism — Obsidian reads tooltip text from `aria-label`), NOT
 * the native `title` attribute (inconsistent styling + long delay).
 */
export function newTabChipTooltip(): string {
	return t("chat.quickPrompts.newTabTooltip", {
		mod: MOD_KEY,
		alt: ALT_KEY,
	});
}
export function thisTabChipTooltip(): string {
	return t("chat.quickPrompts.thisTabTooltip", {
		mod: MOD_KEY,
		shift: SHIFT_KEY,
		alt: ALT_KEY,
	});
}

export interface QuickPromptBarProps {
	/** Prompts already matched to the active note (`matchPromptsForNote`). */
	prompts: QuickPrompt[];
	/** Whether this tab holds a pending queued message. */
	hasPendingQueue: boolean;
	/** Fire / insert a prompt (routes through the engine in the hook). */
	onFire: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void;
	/** Focus the composer and start a ! search (the overflow "+N" affordance). */
	onSearchAll?: () => void;
	/** Open the right-click context menu (Edit / Copy / Rename) for a chip. */
	onChipContextMenu?: (prompt: QuickPrompt, evt: React.MouseEvent) => void;
}

/**
 * Hard upper bound on chips rendered into the DOM. The VISIBLE count is then
 * MEASURED against the row width (QP-I05) so pills stay readable in a narrow
 * leaf — the rest fold into the `+N` overflow → a `!` search. This only bounds
 * DOM size; it is NOT the visible cap.
 */
const MAX_RESTING_CHIPS = 12;

export function QuickPromptBar({
	prompts,
	hasPendingQueue,
	onFire,
	onSearchAll,
	onChipContextMenu,
}: QuickPromptBarProps) {
	const barRef = useRef<HTMLDivElement>(null);
	const [overflowCount, setOverflowCount] = useState(0);
	// Bound DOM size; the visible subset is measured below.
	const { shown } = capRestingChips(prompts, MAX_RESTING_CHIPS);
	const total = prompts.length;

	// Width-aware single-line cap (QP-I05): show as many full-width pills as
	// fit the row, hide the rest, fold them into `+N`. Pills never shrink to
	// unreadable stubs (CSS flex-shrink:0); we trim by COUNT, not by squeezing.
	useLayoutEffect(() => {
		const bar = barRef.current;
		if (!bar || typeof ResizeObserver === "undefined") return;
		const RESERVE = 48; // room for the +N pill
		const GAP = 6;
		const FOLDED = "agent-client-quick-prompt-chip-folded";
		const compute = () => {
			const chips = Array.from(
				bar.querySelectorAll<HTMLElement>(
					".agent-client-quick-prompt-chip",
				),
			);
			if (chips.length === 0) {
				setOverflowCount(0);
				return;
			}
			chips.forEach((c) => c.classList.remove(FOLDED));
			const avail = bar.clientWidth - RESERVE;
			let used = 0;
			let fit = 0;
			for (let i = 0; i < chips.length; i++) {
				used += chips[i].offsetWidth + (i > 0 ? GAP : 0);
				if (used > avail && fit > 0) break;
				fit++;
			}
			chips.forEach((c, i) => {
				c.classList.toggle(FOLDED, i >= fit);
			});
			setOverflowCount(total - fit);
		};
		compute();
		const ro = new ResizeObserver(compute);
		ro.observe(bar);
		return () => ro.disconnect();
	}, [shown, total]);

	// Ephemeral: no matching prompts ⇒ no row at all.
	if (shown.length === 0) return null;
	return (
		<div className="agent-client-quick-prompt-bar" ref={barRef}>
			{shown.map((prompt) => (
				<QuickPromptChip
					key={prompt.id}
					prompt={prompt}
					hasPendingQueue={hasPendingQueue}
					onFire={onFire}
					onChipContextMenu={onChipContextMenu}
				/>
			))}
			{overflowCount > 0 && (
				<button
					type="button"
					className="agent-client-quick-prompt-more"
					aria-label={t("chat.quickPrompts.showMore", {
						count: overflowCount,
					})}
					onClick={(e) => {
						e.preventDefault();
						onSearchAll?.();
					}}
				>
					{`+${overflowCount}`}
				</button>
			)}
		</div>
	);
}

interface QuickPromptChipProps {
	prompt: QuickPrompt;
	hasPendingQueue: boolean;
	onFire: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void;
	onChipContextMenu?: (prompt: QuickPrompt, evt: React.MouseEvent) => void;
}

function QuickPromptChip({
	prompt,
	hasPendingQueue,
	onFire,
	onChipContextMenu,
}: QuickPromptChipProps) {
	const lockRef = useRef<HTMLSpanElement>(null);
	const newTabRef = useRef<HTMLSpanElement>(null);
	const disabled = quickPromptButtonDisabled(prompt, hasPendingQueue);

	useEffect(() => {
		if (lockRef.current) setIcon(lockRef.current, "lock");
	}, [disabled]);

	// New-tab marker: the outward arrow (↗), NOT a return glyph — a return
	// glyph reads as "Enter" and collides with the picker's ↵ = fire.
	useEffect(() => {
		if (prompt.newTab && newTabRef.current) {
			setIcon(newTabRef.current, "external-link");
		}
	}, [prompt.newTab]);

	const activate = (gesture: QuickPromptGesture) => {
		if (disabled) return;
		onFire(prompt, gesture);
	};

	return (
		<button
			type="button"
			className={`agent-client-quick-prompt-chip${
				disabled ? " agent-client-quick-prompt-chip-disabled" : ""
			}`}
			aria-disabled={disabled}
			aria-label={
				disabled
					? `${prompt.label} — ${queuedChipTooltip()}`
					: prompt.newTab
						? newTabChipTooltip()
						: thisTabChipTooltip()
			}
			onClick={(e) => {
				e.preventDefault();
				activate(quickPromptGestureFromEvent(e.nativeEvent));
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					activate(quickPromptGestureFromEvent(e.nativeEvent));
				}
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				onChipContextMenu?.(prompt, e);
			}}
		>
			<span className="agent-client-quick-prompt-chip-label">
				{prompt.label}
			</span>
			{prompt.newTab && (
				<span
					ref={newTabRef}
					className="agent-client-quick-prompt-chip-newtab"
					aria-hidden="true"
				/>
			)}
			{prompt.usesSelection && (
				<span
					className="agent-client-quick-prompt-chip-selection"
					aria-hidden="true"
				>
					{"{ }"}
				</span>
			)}
			{disabled && (
				<span
					ref={lockRef}
					className="agent-client-quick-prompt-chip-lock"
					aria-hidden="true"
				/>
			)}
		</button>
	);
}

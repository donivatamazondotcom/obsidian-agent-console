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
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type { QuickPrompt } from "../types/quick-prompt";
import { quickPromptButtonDisabled } from "../services/quick-prompts-logic";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import { quickPromptGestureFromEvent } from "../utils/quick-prompt-gesture";

/** Tooltip on a disabled current-tab chip — points at the queued banner. */
export const QUEUED_CHIP_TOOLTIP =
	"A message is queued — Edit or Delete it to send something else";

/**
 * Guidance tooltips enumerating the modifier matrix (plain language). Set as
 * the chip's `aria-label` so Obsidian renders its own themed tooltip (the
 * sanctioned mechanism — Obsidian reads tooltip text from `aria-label`), NOT
 * the native `title` attribute (inconsistent styling + long delay).
 */
export const NEW_TAB_CHIP_TOOLTIP =
	"Click: open in a new tab · ⌘-click: open in the background · ⌥-click: drop into the box to edit first";
export const THIS_TAB_CHIP_TOOLTIP =
	"Click: send in this chat · ⌘-click: send in a new background tab (add ⇧ to switch there) · ⌥-click: drop into the box to edit first";

export interface QuickPromptBarProps {
	/** Prompts already matched to the active note (`matchPromptsForNote`). */
	prompts: QuickPrompt[];
	/** Whether this tab holds a pending queued message. */
	hasPendingQueue: boolean;
	/** Fire / insert a prompt (routes through the engine in the hook). */
	onFire: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void;
}

export function QuickPromptBar({
	prompts,
	hasPendingQueue,
	onFire,
}: QuickPromptBarProps) {
	// Ephemeral: no matching prompts ⇒ no row at all.
	if (prompts.length === 0) return null;
	return (
		<div
			className="agent-client-quick-prompt-bar"
			role="toolbar"
			aria-label="Quick prompts"
		>
			{prompts.map((prompt) => (
				<QuickPromptChip
					key={prompt.id}
					prompt={prompt}
					hasPendingQueue={hasPendingQueue}
					onFire={onFire}
				/>
			))}
		</div>
	);
}

interface QuickPromptChipProps {
	prompt: QuickPrompt;
	hasPendingQueue: boolean;
	onFire: (prompt: QuickPrompt, gesture: QuickPromptGesture) => void;
}

function QuickPromptChip({
	prompt,
	hasPendingQueue,
	onFire,
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
					? `${prompt.label} — ${QUEUED_CHIP_TOOLTIP}`
					: prompt.newTab
						? NEW_TAB_CHIP_TOOLTIP
						: THIS_TAB_CHIP_TOOLTIP
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

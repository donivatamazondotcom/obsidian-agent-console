import { useCallback, useEffect, useRef } from "react";
import type { ContextNote, ContextNoteSource } from "../types/context";

export interface ContextStripProps {
	notes: ContextNote[];
	isFull: boolean;
	activeNotePath: string | null;
	activeNoteName: string | null;
	onAdd: (path: string, source: ContextNoteSource) => void;
	onRemove: (path: string) => void;
	onPillClick: (
		path: string,
		event: React.MouseEvent | React.KeyboardEvent,
	) => void;
	/** Decision #26: active-note path to show as a dashed provisional pill, or null. */
	provisionalPath: string | null;
	/** Called when the provisional pill's × is clicked (sticky-suppress for the tab). */
	onSuppressProvisional: () => void;
	/**
	 * Focus the composer. Called when a keyboard removal empties the strip so
	 * focus doesn't fall to document.body. (Mouse-driven removal focus-return is
	 * handled separately by ChatPanel's guarded returnFocusToComposer.)
	 */
	onFocusComposer: () => void;
}

/** Derive display name from vault-relative path (basename without extension). */
function displayName(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/** Identifies the focused pill to the Mod/Alt+Enter keymap scope in ChatPanel. */
export const PILL_PATH_ATTR = "data-context-pill-path";

/**
 * Context strip — a grab (+) button plus a row of removable note pills.
 *
 * Each pill is a SINGLE focusable token (one tab stop): open it (click / Enter /
 * middle-click, honoring ⌘/⌃/⌥/⇧ to open in a new tab/split/window like any
 * Obsidian link) or remove it (Backspace/Delete while focused, or the × button
 * by mouse — the × is not a separate tab stop). After a keyboard removal, focus
 * moves to the next pill (or the previous, or the composer when none remain) so
 * the keyboard user is never stranded on document.body.
 *
 * There is no text-entry field. An inline type-to-add/search affordance was
 * advertised by a placeholder but never wired (see I62); the type-to-search
 * picker it stood in for is not being shipped, so the input — and the two-step
 * "Backspace from empty field selects then removes" scaffolding it required —
 * were removed (I148). Removal now lives on the focused pill.
 */
export function ContextStrip({
	notes,
	isFull,
	activeNotePath,
	activeNoteName,
	onAdd,
	onRemove,
	onPillClick,
	provisionalPath,
	onSuppressProvisional,
	onFocusComposer,
}: ContextStripProps) {
	const isAlreadyCrystallized =
		activeNotePath != null && notes.some((n) => n.path === activeNotePath);
	const grabDisabled = !activeNotePath || isAlreadyCrystallized || isFull;

	// Pill name nodes by path, for moving focus after a keyboard removal.
	const pillRefs = useRef(new Map<string, HTMLSpanElement>());
	// Where focus should land once the post-removal re-render commits.
	const pendingFocus = useRef<
		{ kind: "pill"; path: string } | { kind: "composer" } | null
	>(null);

	const handleGrabClick = useCallback(() => {
		if (activeNotePath && !grabDisabled) {
			onAdd(activeNotePath, "user");
			// Pinning is a one-shot action — drop focus into the composer so the
			// user can keep typing (the grab button also disables itself once the
			// note is pinned). Unconditional, unlike ChatPanel's guarded
			// returnFocusToComposer, which no-ops for a mouse click that never
			// had composer focus.
			onFocusComposer();
		}
	}, [activeNotePath, grabDisabled, onAdd, onFocusComposer]);

	// Remove a crystallized pill at index `i`, then queue focus to its neighbor
	// (next, else previous), or the composer when it was the last pill.
	const removePillAt = useCallback(
		(i: number) => {
			const next = notes[i + 1]?.path ?? notes[i - 1]?.path ?? null;
			pendingFocus.current = next
				? { kind: "pill", path: next }
				: { kind: "composer" };
			onRemove(notes[i].path);
		},
		[notes, onRemove],
	);

	// Suppress the provisional pill, then queue focus to the last crystallized
	// pill, or the composer when there are none.
	const suppressProvisional = useCallback(() => {
		const last = notes[notes.length - 1]?.path ?? null;
		pendingFocus.current = last
			? { kind: "pill", path: last }
			: { kind: "composer" };
		onSuppressProvisional();
	}, [notes, onSuppressProvisional]);

	// Apply the queued focus after the removal re-render commits.
	useEffect(() => {
		const pf = pendingFocus.current;
		if (!pf) return;
		pendingFocus.current = null;
		if (pf.kind === "pill") {
			const el = pillRefs.current.get(pf.path);
			if (el) {
				el.focus();
				return;
			}
		}
		onFocusComposer();
	}, [notes, provisionalPath, onFocusComposer]);

	return (
		<div className="context-strip">
			<button
				className="context-strip-grab"
				data-acp-focus-cluster=""
				disabled={grabDisabled}
				aria-label={
					grabDisabled
						? !activeNotePath
							? "No active note to pin"
							: isAlreadyCrystallized
								? `${activeNoteName} is already in context`
								: "Maximum 8 context notes. Remove one to add another."
						: `Pin: ${activeNoteName}`
				}
				onClick={handleGrabClick}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
			</button>
			<div className="context-strip-field">
				{notes.map((note, i) => (
					<span key={note.path} className="context-strip-pill">
						<span
							className="context-strip-pill-name"
							role="link"
							tabIndex={0}
							aria-label={displayName(note.path)}
							{...{ [PILL_PATH_ATTR]: note.path }}
							ref={(el) => {
								if (el) pillRefs.current.set(note.path, el);
								else pillRefs.current.delete(note.path);
							}}
							onClick={(e) => onPillClick(note.path, e)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									onPillClick(note.path, e);
								} else if (e.key === "Backspace" || e.key === "Delete") {
									e.preventDefault();
									removePillAt(i);
								}
							}}
							onAuxClick={(e) => {
								if (e.button !== 1) return;
								e.preventDefault();
								onPillClick(note.path, e);
							}}
						>
							{displayName(note.path)}
						</span>
						<button
							className="context-strip-pill-remove"
							data-acp-focus-cluster=""
							tabIndex={-1}
							aria-label="Remove note from context"
							onClick={() => onRemove(note.path)}
						>
							×
						</button>
					</span>
				))}
				{provisionalPath && (
					<span
						key="__provisional__"
						className="context-strip-pill context-strip-pill--provisional"
					>
						<span
							className="context-strip-pill-name"
							role="link"
							tabIndex={0}
							aria-label={displayName(provisionalPath)}
							{...{ [PILL_PATH_ATTR]: provisionalPath }}
							onClick={(e) => onPillClick(provisionalPath, e)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									onPillClick(provisionalPath, e);
								} else if (e.key === "Backspace" || e.key === "Delete") {
									e.preventDefault();
									suppressProvisional();
								}
							}}
							onAuxClick={(e) => {
								if (e.button !== 1) return;
								e.preventDefault();
								onPillClick(provisionalPath, e);
							}}
						>
							{displayName(provisionalPath)}
						</span>
						<button
							className="context-strip-pill-remove"
							data-acp-focus-cluster=""
							tabIndex={-1}
							aria-label="Don't add the active note as context for this chat"
							onClick={onSuppressProvisional}
						>
							×
						</button>
					</span>
				)}
			</div>
		</div>
	);
}

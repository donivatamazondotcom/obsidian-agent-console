import { useState, useRef, useCallback } from "react";
import type { ContextNote, ContextNoteSource } from "../types/context";

export interface ContextStripProps {
	notes: ContextNote[];
	isFull: boolean;
	activeNotePath: string | null;
	activeNoteName: string | null;
	onAdd: (path: string, source: ContextNoteSource) => void;
	onRemove: (path: string) => void;
	onPillClick: (path: string, event: React.MouseEvent) => void;
	/** Decision #26: active-note path to show as a dashed provisional pill, or null. */
	provisionalPath: string | null;
	/** Called when the provisional pill's × is clicked (sticky-suppress for the tab). */
	onSuppressProvisional: () => void;
}

/** Derive display name from vault-relative path (basename without extension). */
function displayName(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Context strip — tag-input field with crystallized pills + grab button.
 * Follows Obsidian's property/tag input pattern.
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
}: ContextStripProps) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const isAlreadyCrystallized =
		activeNotePath != null && notes.some((n) => n.path === activeNotePath);
	const grabDisabled = !activeNotePath || isAlreadyCrystallized || isFull;

	const handleGrabClick = useCallback(() => {
		if (activeNotePath && !grabDisabled) {
			onAdd(activeNotePath, "user");
		}
	}, [activeNotePath, grabDisabled, onAdd]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			const input = inputRef.current;
			if (!input) return;

			if (e.key === "Escape") {
				input.blur();
				setSelectedIndex(null);
				return;
			}

			if (e.key === "Backspace" && input.value === "") {
				e.preventDefault();
				if (selectedIndex != null) {
					// Second Backspace — remove selected pill
					onRemove(notes[selectedIndex].path);
					setSelectedIndex(null);
				} else if (notes.length > 0) {
					// First Backspace — select last pill
					setSelectedIndex(notes.length - 1);
				}
				return;
			}

			// Any other key clears pill selection
			if (selectedIndex != null) {
				setSelectedIndex(null);
			}
		},
		[notes, selectedIndex, onRemove],
	);

	return (
		<div className="context-strip">
			<button
				className="context-strip-grab"
				disabled={grabDisabled}
				aria-label={
					grabDisabled
						? !activeNotePath
							? "No active note to add"
							: isAlreadyCrystallized
								? `${activeNoteName} is already in context`
								: "Maximum 8 context notes. Remove one to add another."
						: `Add: ${activeNoteName}`
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
					<span
						key={note.path}
						className={`context-strip-pill${selectedIndex === i ? " context-strip-pill--selected" : ""}`}
					>
						<span
							className="context-strip-pill-name"
							aria-label={displayName(note.path)}
							onClick={(e) => onPillClick(note.path, e)}
						>
							{displayName(note.path)}
						</span>
						<button
							className="context-strip-pill-remove"
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
							aria-label={displayName(provisionalPath)}
							onClick={(e) => onPillClick(provisionalPath, e)}
						>
							{displayName(provisionalPath)}
						</span>
						<button
							className="context-strip-pill-remove"
							aria-label="Don't add the active note as context for this chat"
							onClick={onSuppressProvisional}
						>
							×
						</button>
					</span>
				)}
				<input
					ref={inputRef}
					className="context-strip-input"
					placeholder="Add notes with +"
					onKeyDown={handleKeyDown}
					onFocus={() => setSelectedIndex(null)}
				/>
			</div>
		</div>
	);
}

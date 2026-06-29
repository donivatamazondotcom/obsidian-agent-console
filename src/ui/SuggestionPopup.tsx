import * as React from "react";
const { useRef, useEffect } = React;
import type { NoteMetadata } from "../services/vault-service";
import type { SlashCommand } from "../types/session";
import type { QuickPrompt } from "../types/quick-prompt";
import { MOD_KEY, ALT_KEY, SHIFT_KEY, ENTER_KEY, modCombo } from "../utils/platform";
import type { CreatePromptRow } from "../services/quick-prompts-logic";

/**
 * Dropdown type for suggestion display.
 */
type DropdownType = "mention" | "slash-command" | "quick-prompt";

/**
 * Props for the SuggestionPopup component.
 *
 * This component can display either note mentions or slash commands
 * based on the `type` prop.
 */
interface SuggestionPopupProps {
	/** Type of dropdown to display */
	type: DropdownType;

	/** Items to display (NoteMetadata for mentions, SlashCommand for commands) */
	items: NoteMetadata[] | SlashCommand[] | QuickPrompt[];

	/** Currently selected item index */
	selectedIndex: number;

	/** Callback when an item is selected */
	onSelect: (
		item: NoteMetadata | SlashCommand | QuickPrompt,
		evt?: React.MouseEvent | React.KeyboardEvent,
	) => void;

	/** Callback to close the dropdown */
	onClose: () => void;

	/** Quick-prompt only: the "create" row appended when the query has no match. */
	createRow?: CreatePromptRow | null;
	/** Quick-prompt only: invoked when the create row is chosen. */
	onCreate?: () => void;
}

/**
 * Generic suggestion popup component.
 *
 * Displays either:
 * - Note mentions (@[[note]])
 * - Slash commands (/command)
 *
 * Handles keyboard navigation, mouse selection, and outside click detection.
 */
export function SuggestionPopup({
	type,
	items,
	selectedIndex,
	onSelect,
	onClose,
	createRow,
	onCreate,
}: SuggestionPopupProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Handle mouse clicks outside dropdown to close
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		const doc = activeDocument;
		doc.addEventListener("mousedown", handleClickOutside);
		return () => {
			doc.removeEventListener("mousedown", handleClickOutside);
		};
	}, [onClose]);

	// Scroll selected item into view
	useEffect(() => {
		if (!dropdownRef.current) return;
		const selectedElement = dropdownRef.current.children[selectedIndex] as
			| HTMLElement
			| undefined;
		selectedElement?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (items.length === 0 && !createRow) {
		return null;
	}

	/**
	 * Render a single dropdown item based on type.
	 */
	const renderItem = (
		item: NoteMetadata | SlashCommand | QuickPrompt,
		index: number,
	) => {
		const isSelected = index === selectedIndex;
		const hasBorder = index < items.length - 1;

		if (type === "mention") {
			const note = item as NoteMetadata;
			return (
				<div
					key={`mention-${index}`}
					role="option"
					tabIndex={-1}
					aria-selected={isSelected}
					className={`agent-client-mention-dropdown-item ${isSelected ? "agent-client-selected" : ""} ${hasBorder ? "agent-client-has-border" : ""}`}
					onClick={() => onSelect(note)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onSelect(note);
						}
					}}
					onMouseEnter={() => {
						// Could update selected index on hover
					}}
				>
					<div className="agent-client-mention-dropdown-item-name">
						{note.name}
					</div>
					<div className="agent-client-mention-dropdown-item-path">
						{note.path}
					</div>
				</div>
			);
		} else if (type === "slash-command") {
			// type === "slash-command"
			const command = item as SlashCommand;
			return (
				<div
					key={`command-${index}`}
					role="option"
					tabIndex={-1}
					aria-selected={isSelected}
					className={`agent-client-mention-dropdown-item ${isSelected ? "agent-client-selected" : ""} ${hasBorder ? "agent-client-has-border" : ""}`}
					onClick={() => onSelect(command)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onSelect(command);
						}
					}}
					onMouseEnter={() => {
						// Could update selected index on hover
					}}
				>
					<div className="agent-client-mention-dropdown-item-name">
						/{command.name}
					</div>
					<div className="agent-client-mention-dropdown-item-path">
						{command.description}
						{command.hint && ` (${command.hint})`}
					</div>
				</div>
			);
		} else {
			// type === "quick-prompt"
			const prompt = item as QuickPrompt;
			return (
				<div
					key={`qp-${index}`}
					role="option"
					tabIndex={-1}
					aria-selected={isSelected}
					className={`agent-client-mention-dropdown-item ${isSelected ? "agent-client-selected" : ""} ${hasBorder ? "agent-client-has-border" : ""}`}
					onClick={(e) => onSelect(prompt, e)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onSelect(prompt, e);
						}
					}}
				>
					<div className="agent-client-mention-dropdown-item-name">
						{prompt.label}
						{prompt.newTab && (
							<span className="agent-client-quick-prompt-row-marker">
								{" ↗"}
							</span>
						)}
						{prompt.usesSelection && (
							<span className="agent-client-quick-prompt-row-marker">
								{" { }"}
							</span>
						)}
					</div>
				</div>
			);
		}
	};

	return (
		<div ref={dropdownRef} className="agent-client-mention-dropdown" role="listbox">
			{items.map((item, index) => renderItem(item, index))}
			{type === "quick-prompt" && createRow && (
				<div
					role="option"
					tabIndex={-1}
					aria-selected={selectedIndex === items.length}
					className={`agent-client-mention-dropdown-item agent-client-quick-prompt-create-row ${selectedIndex === items.length ? "agent-client-selected" : ""}`}
					onClick={() => onCreate?.()}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onCreate?.();
						}
					}}
				>
					<div className="agent-client-mention-dropdown-item-name">
						<span className="agent-client-quick-prompt-create-icon">
							+
						</span>
						{createRow.label}
					</div>
				</div>
			)}
			{type === "quick-prompt" && (
				<div
					className="agent-client-quick-prompt-legend"
					aria-hidden="true"
				>
					{createRow && selectedIndex === items.length ? (
						<span>{ENTER_KEY} create</span>
					) : (
						<>
							<span>{ENTER_KEY} run</span>
							<span>{modCombo(MOD_KEY, ENTER_KEY)} new tab</span>
							<span>
								{modCombo(MOD_KEY, SHIFT_KEY, ENTER_KEY)} switch
							</span>
							<span>{modCombo(ALT_KEY, ENTER_KEY)} insert</span>
						</>
					)}
				</div>
			)}
		</div>
	);
}

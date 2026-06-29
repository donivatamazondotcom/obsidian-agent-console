import * as React from "react";
const { useRef, useEffect } = React;
import type {
	PickerItem,
	PickerInstruction,
	PickerCreateRow,
} from "../types/picker";

/**
 * Props for the unified suggestion popup.
 *
 * The popup is domain-agnostic: it renders a list of {@link PickerItem} rows and
 * an optional pinned {@link PickerInstruction} footer. Each caller (mention `@`,
 * slash `/`, quick-prompt `!`) projects its own items and supplies its own
 * instructions — the control hardcodes neither row layout nor help text.
 *
 * Spec: [[Unified Picker Control]] (Tier 1 — unified view).
 */
interface SuggestionPopupProps {
	/** Rows to display. */
	items: PickerItem[];

	/** Pinned footer hints. Omit/empty → no footer. */
	instructions?: PickerInstruction[];

	/** Index of the currently selected row (an index of `items.length` selects the create row). */
	selectedIndex: number;

	/**
	 * Invoked when a row is chosen (click or Enter on a focused row). Reports the
	 * row index; the caller maps it back to its domain item. The DOM event is
	 * forwarded so a caller can read modifier keys (e.g. the quick-prompt 2×2
	 * gesture).
	 */
	onSelect: (
		index: number,
		evt?: React.MouseEvent | React.KeyboardEvent,
	) => void;

	/** Callback to close the dropdown (outside click). */
	onClose: () => void;

	/** Optional "create" row appended after the items (quick-prompt). */
	createRow?: PickerCreateRow | null;
	/** Invoked when the create row is chosen. */
	onCreate?: () => void;
}

/**
 * Generic suggestion popup.
 *
 * Handles keyboard-row activation, mouse selection, outside-click dismissal, and
 * scroll-into-view of the selected row. The pinned footer lives OUTSIDE the
 * scrollable rows container so it stays visible and never forces an always-on
 * scrollbar.
 */
export function SuggestionPopup({
	items,
	instructions,
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

	// Scroll the selected row into view within the scrollable rows container.
	// Query `.agent-client-selected` (not children[index]) so this stays correct
	// with the legend footer living OUTSIDE the scroll area.
	useEffect(() => {
		const selected = dropdownRef.current?.querySelector<HTMLElement>(
			".agent-client-selected",
		);
		selected?.scrollIntoView?.({ block: "nearest" });
	}, [selectedIndex]);

	if (items.length === 0 && !createRow) {
		return null;
	}

	const hasInstructions = !!instructions && instructions.length > 0;

	return (
		<div
			ref={dropdownRef}
			className="agent-client-mention-dropdown"
			role="listbox"
		>
			<div className="agent-client-mention-dropdown-scroll">
				{items.map((item, index) => {
					const isSelected = index === selectedIndex;
					const layout = item.layout ?? "stacked";
					return (
						<div
							key={item.id}
							role="option"
							tabIndex={-1}
							aria-selected={isSelected}
							className={`agent-client-mention-dropdown-item agent-client-picker-item-${layout} ${isSelected ? "agent-client-selected" : ""}`}
							onClick={(e) => onSelect(index, e)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									onSelect(index, e);
								}
							}}
						>
							<div className="agent-client-mention-dropdown-item-name">
								{item.title}
								{item.markers?.map((marker, i) => (
									<span
										key={i}
										className="agent-client-quick-prompt-row-marker"
										aria-label={marker.label}
									>
										{` ${marker.glyph}`}
									</span>
								))}
							</div>
							{item.subtitle ? (
								<div className="agent-client-mention-dropdown-item-path">
									{item.subtitle}
								</div>
							) : null}
						</div>
					);
				})}
				{createRow && (
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
			</div>
			{hasInstructions && (
				<div
					className="agent-client-mention-dropdown-instructions"
					aria-hidden="true"
				>
					{instructions.map((instruction, i) => (
						<span key={i}>
							{instruction.keys} {instruction.label}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

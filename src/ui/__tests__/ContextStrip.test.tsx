/**
 * Unit tests for ContextStrip component.
 *
 * TDD — written before implementation. Covers:
 * - Pill rendering from contextNotes array
 * - Grab button states (enabled/disabled/tooltip)
 * - Pill removal via × click
 * - Keyboard navigation (arrow-left into pills, Backspace to select/remove)
 * - Placeholder when empty
 * - Cap-reached disabled state
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextStrip } from "../ContextStrip";
import type { ContextNote } from "../../types/context";

// Minimal props factory
function makeProps(overrides: Partial<Parameters<typeof ContextStrip>[0]> = {}) {
	return {
		notes: [] as ContextNote[],
		isFull: false,
		activeNotePath: null,
		activeNoteName: null,
		onAdd: vi.fn(),
		onRemove: vi.fn(),
		onPillClick: vi.fn(),
		provisionalPath: null,
		onSuppressProvisional: vi.fn(),
		...overrides,
	};
}

describe("ContextStrip", () => {
	afterEach(cleanup);

	// ========================================================================
	// Rendering
	// ========================================================================

	it("renders placeholder when no notes crystallized", () => {
		render(<ContextStrip {...makeProps()} />);
		expect(screen.getByPlaceholderText("Add notes with +")).toBeTruthy();
	});

	it("renders pills for each crystallized note", () => {
		const notes: ContextNote[] = [
			{ path: "folder/Design Doc.md", source: "user", seen: false },
			{ path: "API Spec.md", source: "mention", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes })} />);
		expect(screen.getByText("Design Doc")).toBeTruthy();
		expect(screen.getByText("API Spec")).toBeTruthy();
	});

	it("derives display name from path basename without extension", () => {
		const notes: ContextNote[] = [
			{ path: "deep/nested/My Note.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes })} />);
		expect(screen.getByText("My Note")).toBeTruthy();
	});

	// ========================================================================
	// Grab button
	// ========================================================================

	it("grab button is enabled when activeNotePath is set and not already crystallized", () => {
		render(
			<ContextStrip
				{...makeProps({
					activeNotePath: "note.md",
					activeNoteName: "note",
				})}
			/>,
		);
		const btn = screen.getByLabelText("Add: note");
		expect((btn as HTMLButtonElement).disabled).toBe(false);
	});

	it("grab button is disabled when no active note", () => {
		render(<ContextStrip {...makeProps()} />);
		const btn = screen.getByLabelText("No active note to add");
		expect((btn as HTMLButtonElement).disabled).toBe(true);
	});

	it("grab button is disabled when active note is already crystallized", () => {
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		render(
			<ContextStrip
				{...makeProps({
					notes,
					activeNotePath: "note.md",
					activeNoteName: "note",
				})}
			/>,
		);
		const btn = screen.getByLabelText("note is already in context");
		expect((btn as HTMLButtonElement).disabled).toBe(true);
	});

	it("grab button is disabled when at cap", () => {
		render(
			<ContextStrip
				{...makeProps({
					isFull: true,
					activeNotePath: "note.md",
					activeNoteName: "note",
				})}
			/>,
		);
		const btn = screen.getByLabelText("Maximum 8 context notes. Remove one to add another.");
		expect((btn as HTMLButtonElement).disabled).toBe(true);
	});

	it("clicking grab button calls onAdd with active note path and 'user' source", () => {
		const onAdd = vi.fn();
		render(
			<ContextStrip
				{...makeProps({
					activeNotePath: "note.md",
					activeNoteName: "note",
					onAdd,
				})}
			/>,
		);
		fireEvent.click(screen.getByLabelText("Add: note"));
		expect(onAdd).toHaveBeenCalledWith("note.md", "user");
	});

	// ========================================================================
	// Pill removal
	// ========================================================================

	it("clicking × on a pill calls onRemove with the path", () => {
		const onRemove = vi.fn();
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onRemove })} />);
		const removeBtn = screen.getByLabelText("Remove note from context");
		fireEvent.click(removeBtn);
		expect(onRemove).toHaveBeenCalledWith("note.md");
	});

	// ========================================================================
	// Pill click (open note)
	// ========================================================================

	it("clicking pill name calls onPillClick with path and mouse event", () => {
		const onPillClick = vi.fn();
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onPillClick })} />);
		fireEvent.click(screen.getByText("note"));
		expect(onPillClick).toHaveBeenCalledWith(
			"note.md",
			expect.any(Object),
		);
	});

	// ========================================================================
	// Keyboard navigation
	// ========================================================================

	it("Backspace with empty input selects last pill", () => {
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
		];
		const { container } = render(
			<ContextStrip {...makeProps({ notes })} />,
		);
		const input = screen.getByPlaceholderText("Add notes with +");
		fireEvent.keyDown(input, { key: "Backspace" });
		// Last pill should have selected class
		const pills = container.querySelectorAll(".context-strip-pill");
		expect(
			pills[pills.length - 1].classList.contains(
				"context-strip-pill--selected",
			),
		).toBe(true);
	});

	it("Backspace on selected pill calls onRemove", () => {
		const onRemove = vi.fn();
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onRemove })} />);
		const input = screen.getByPlaceholderText("Add notes with +");
		// First Backspace selects
		fireEvent.keyDown(input, { key: "Backspace" });
		// Second Backspace removes
		fireEvent.keyDown(input, { key: "Backspace" });
		expect(onRemove).toHaveBeenCalledWith("b.md");
	});

	it("Escape blurs the strip input", () => {
		render(<ContextStrip {...makeProps()} />);
		const input = screen.getByPlaceholderText("Add notes with +");
		input.focus();
		fireEvent.keyDown(input, { key: "Escape" });
		expect(document.activeElement).not.toBe(input);
	});

	// ========================================================================
	// Provisional pill (Decision #26, I68)
	// ========================================================================

	it("renders a dashed provisional pill; its × calls onSuppressProvisional", () => {
		const onSuppressProvisional = vi.fn();
		const { container } = render(
			<ContextStrip
				{...makeProps({
					provisionalPath: "folder/Draft.md",
					onSuppressProvisional,
				})}
			/>,
		);
		expect(screen.getByText("Draft")).toBeTruthy();
		expect(
			container.querySelector(".context-strip-pill--provisional"),
		).toBeTruthy();
		fireEvent.click(
			screen.getByLabelText(
				"Don't add the active note as context for this chat",
			),
		);
		expect(onSuppressProvisional).toHaveBeenCalledTimes(1);
	});

	it("renders no provisional pill when provisionalPath is null", () => {
		const { container } = render(<ContextStrip {...makeProps()} />);
		expect(
			container.querySelector(".context-strip-pill--provisional"),
		).toBeNull();
	});
});

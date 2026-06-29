/**
 * Unit tests for ContextStrip component.
 *
 * Covers:
 * - Pill rendering from contextNotes array
 * - Grab button states (enabled/disabled/tooltip)
 * - Pill removal via × click and via Backspace/Delete on a focused pill
 * - Pill click (open note)
 * - Provisional (dashed) pill render + suppression
 * - No text input (typing-to-add was never wired and has been removed)
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
		onFocusComposer: vi.fn(),
		...overrides,
	};
}

describe("ContextStrip", () => {
	afterEach(cleanup);

	// ========================================================================
	// Rendering
	// ========================================================================

	it("renders no text input — typing-to-add was removed", () => {
		const { container } = render(<ContextStrip {...makeProps()} />);
		expect(container.querySelector("input")).toBeNull();
		expect(container.querySelector(".context-strip-field")).toBeTruthy();
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
		const btn = screen.getByLabelText("Pin: note");
		expect((btn as HTMLButtonElement).disabled).toBe(false);
	});

	it("grab button is disabled when no active note", () => {
		render(<ContextStrip {...makeProps()} />);
		const btn = screen.getByLabelText("No active note to pin");
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

	it("clicking grab button calls onAdd with active note path and 'user' source, then focuses the composer", () => {
		const onAdd = vi.fn();
		const onFocusComposer = vi.fn();
		render(
			<ContextStrip
				{...makeProps({
					activeNotePath: "note.md",
					activeNoteName: "note",
					onAdd,
					onFocusComposer,
				})}
			/>,
		);
		fireEvent.click(screen.getByLabelText("Pin: note"));
		expect(onAdd).toHaveBeenCalledWith("note.md", "user");
		expect(onFocusComposer).toHaveBeenCalledTimes(1);
	});

	// ========================================================================
	// Pill removal — × click
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

	it("Enter on a focused pill opens the note", () => {
		const onPillClick = vi.fn();
		const notes: ContextNote[] = [
			{ path: "note.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onPillClick })} />);
		fireEvent.keyDown(screen.getByText("note"), { key: "Enter" });
		expect(onPillClick).toHaveBeenCalledWith("note.md", expect.any(Object));
	});

	// ========================================================================
	// Pill removal — Backspace/Delete on the focused pill (per-pill, one-step)
	// ========================================================================

	it("Backspace on a focused pill removes that pill", () => {
		const onRemove = vi.fn();
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onRemove })} />);
		fireEvent.keyDown(screen.getByText("a"), { key: "Backspace" });
		expect(onRemove).toHaveBeenCalledWith("a.md");
	});

	it("Delete on a focused pill removes that pill", () => {
		const onRemove = vi.fn();
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
		];
		render(<ContextStrip {...makeProps({ notes, onRemove })} />);
		fireEvent.keyDown(screen.getByText("a"), { key: "Delete" });
		expect(onRemove).toHaveBeenCalledWith("a.md");
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

	it("Backspace on the focused provisional pill calls onSuppressProvisional", () => {
		const onSuppressProvisional = vi.fn();
		render(
			<ContextStrip
				{...makeProps({
					provisionalPath: "folder/Draft.md",
					onSuppressProvisional,
				})}
			/>,
		);
		fireEvent.keyDown(screen.getByText("Draft"), { key: "Backspace" });
		expect(onSuppressProvisional).toHaveBeenCalledTimes(1);
	});

	it("Delete on the focused provisional pill calls onSuppressProvisional", () => {
		const onSuppressProvisional = vi.fn();
		render(
			<ContextStrip
				{...makeProps({
					provisionalPath: "folder/Draft.md",
					onSuppressProvisional,
				})}
			/>,
		);
		fireEvent.keyDown(screen.getByText("Draft"), { key: "Delete" });
		expect(onSuppressProvisional).toHaveBeenCalledTimes(1);
	});

	// ========================================================================
	// Focus management after keyboard removal (g)
	// ========================================================================

	function focusedPath(): string | null {
		return document.activeElement?.getAttribute("data-context-pill-path") ?? null;
	}

	it("moves focus to the NEXT pill after Backspace removes a focused middle pill", () => {
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
			{ path: "c.md", source: "user", seen: false },
		];
		const { rerender } = render(<ContextStrip {...makeProps({ notes })} />);
		(screen.getByText("b") as HTMLElement).focus();
		fireEvent.keyDown(screen.getByText("b"), { key: "Backspace" });
		// Parent removes b → re-render with [a, c]; the queued focus lands on c.
		rerender(
			<ContextStrip
				{...makeProps({
					notes: [
						{ path: "a.md", source: "user", seen: false },
						{ path: "c.md", source: "user", seen: false },
					],
				})}
			/>,
		);
		expect(focusedPath()).toBe("c.md");
	});

	it("moves focus to the PREVIOUS pill when the focused LAST pill is removed", () => {
		const notes: ContextNote[] = [
			{ path: "a.md", source: "user", seen: false },
			{ path: "b.md", source: "user", seen: false },
		];
		const { rerender } = render(<ContextStrip {...makeProps({ notes })} />);
		(screen.getByText("b") as HTMLElement).focus();
		fireEvent.keyDown(screen.getByText("b"), { key: "Delete" });
		rerender(
			<ContextStrip
				{...makeProps({
					notes: [{ path: "a.md", source: "user", seen: false }],
				})}
			/>,
		);
		expect(focusedPath()).toBe("a.md");
	});

	it("calls onFocusComposer when the LAST remaining pill is removed", () => {
		const onFocusComposer = vi.fn();
		const notes: ContextNote[] = [
			{ path: "only.md", source: "user", seen: false },
		];
		const { rerender } = render(
			<ContextStrip {...makeProps({ notes, onFocusComposer })} />,
		);
		(screen.getByText("only") as HTMLElement).focus();
		fireEvent.keyDown(screen.getByText("only"), { key: "Backspace" });
		rerender(<ContextStrip {...makeProps({ notes: [], onFocusComposer })} />);
		expect(onFocusComposer).toHaveBeenCalledTimes(1);
	});
});

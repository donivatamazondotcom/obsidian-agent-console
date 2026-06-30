/**
 * usePicker — the one suggestion-picker state machine (Tier 3).
 *
 * Drives any PickerSource. These tests pin the shared mechanics the three
 * sources rely on, exercised through the real source configs:
 *   - async (mention) vs sync (slash / quick-prompt) fetch
 *   - the unified isOpen rule: (items>0 || createRow) && triggerActive
 *   - navigation policy: clamp (mention/slash) vs wrap (quick-prompt)
 *   - the stateful dismiss guard (mention): stays closed for the @ run
 *   - close() clears the guard; dismiss() sets it
 *   - selectSuggestion rewrites the text and closes
 *
 * Spec: [[Unified Picker Control]] (Tier 3).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePicker } from "../usePicker";
import {
	makeMentionSource,
	makeSlashSource,
	makeQuickPromptSource,
	type FuzzyScorer,
} from "../../utils/picker-source-configs";
import type { NoteMetadata } from "../../services/vault-service";
import type { SlashCommand } from "../../types/session";
import type { QuickPrompt } from "../../types/quick-prompt";

const note = (name: string): NoteMetadata => ({
	path: `${name}.md`,
	name,
	extension: "md",
	created: 0,
	modified: 0,
});
const cmd = (name: string): SlashCommand => ({
	name,
	description: `${name} command`,
});
const qp = (id: string, label: string): QuickPrompt => ({
	id,
	label,
	body: `b ${label}`,
	path: `Quick Prompts/${id}.md`,
	usesSelection: false,
});
const substringScorer = (query: string): FuzzyScorer => {
	const q = query.toLowerCase();
	return (text: string) =>
		text.toLowerCase().includes(q) ? { score: -text.length } : null;
};

function mentionSource(notes: NoteMetadata[]) {
	return makeMentionSource(async (q) =>
		notes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())),
	);
}

describe("usePicker — shared state machine (Tier 3)", () => {
	it("starts closed and empty", () => {
		const { result } = renderHook(() =>
			usePicker(makeSlashSource([cmd("help")])),
		);
		expect(result.current.isOpen).toBe(false);
		expect(result.current.items).toEqual([]);
		expect(result.current.createRow).toBeNull();
	});

	it("fetches asynchronously for the mention source (await populates items)", async () => {
		const source = mentionSource([note("Alpha"), note("Beta")]);
		const { result } = renderHook(() => usePicker(source));
		await act(async () => {
			await result.current.updateSuggestions("@a", 2);
		});
		expect(result.current.isOpen).toBe(true);
		expect(result.current.items.map((n) => n.name)).toEqual([
			"Alpha",
			"Beta",
		]);
		expect(result.current.selectedIndex).toBe(0);
	});

	it("fetches synchronously for the slash source (state set in the same act)", () => {
		const source = makeSlashSource([cmd("help"), cmd("clear")]);
		const { result } = renderHook(() => usePicker(source));
		act(() => {
			result.current.updateSuggestions("/he", 3);
		});
		expect(result.current.isOpen).toBe(true);
		expect(result.current.items.map((c) => c.name)).toEqual(["help"]);
	});

	it("isOpen is false when the trigger is inactive", () => {
		const source = makeSlashSource([cmd("help")]);
		const { result } = renderHook(() => usePicker(source));
		act(() => result.current.updateSuggestions("no slash", 8));
		expect(result.current.isOpen).toBe(false);
	});

	it("opens on the create row alone even when zero items match (quick-prompt)", () => {
		const source = makeQuickPromptSource(
			[qp("debrief", "Debrief")],
			substringScorer,
		);
		const { result } = renderHook(() => usePicker(source));
		act(() => result.current.updateSuggestions("!zzz", 4));
		// No prompt matches "zzz", but the create row is always present.
		expect(result.current.items).toEqual([]);
		expect(result.current.createRow).not.toBeNull();
		expect(result.current.isOpen).toBe(true);
	});

	it("clamps navigation for the slash source (no wrap at the ends)", () => {
		const source = makeSlashSource([cmd("clear"), cmd("compact")]);
		const { result } = renderHook(() => usePicker(source));
		act(() => result.current.updateSuggestions("/c", 2));
		// Up from 0 clamps at 0.
		act(() => result.current.navigate("up"));
		expect(result.current.selectedIndex).toBe(0);
		// Down advances then clamps at the last index.
		act(() => result.current.navigate("down"));
		expect(result.current.selectedIndex).toBe(1);
		act(() => result.current.navigate("down"));
		expect(result.current.selectedIndex).toBe(1);
	});

	it("wraps navigation for the quick-prompt source (circular around the create row)", () => {
		const source = makeQuickPromptSource(
			[qp("debrief", "Debrief")],
			substringScorer,
		);
		const { result } = renderHook(() => usePicker(source));
		act(() => result.current.updateSuggestions("!de", 3));
		// 1 ranked item (index 0) + create row (index 1).
		expect(result.current.selectedIndex).toBe(0);
		act(() => result.current.navigate("up"));
		expect(result.current.selectedIndex).toBe(1); // wrapped to create row
		act(() => result.current.navigate("down"));
		expect(result.current.selectedIndex).toBe(0); // wrapped back to top
	});

	it("keeps the dismiss guard for the @ run, reopening only on a new @ or when the caret leaves", async () => {
		const source = mentionSource([note("Agent Console")]);
		const { result } = renderHook(() => usePicker(source));
		await act(async () => {
			await result.current.updateSuggestions("@agent", 6);
		});
		expect(result.current.isOpen).toBe(true);

		// dismiss() remembers this run's start and closes it.
		act(() => result.current.dismiss());
		expect(result.current.isOpen).toBe(false);

		// More typing in the SAME run stays closed.
		await act(async () => {
			await result.current.updateSuggestions("@agent ", 7);
		});
		expect(result.current.isOpen).toBe(false);

		// Caret leaves the mention → guard clears.
		await act(async () => {
			await result.current.updateSuggestions("plain", 5);
		});
		expect(result.current.isOpen).toBe(false);

		// A fresh @ reopens.
		await act(async () => {
			await result.current.updateSuggestions("plain @ag", 9);
		});
		expect(result.current.isOpen).toBe(true);
	});

	it("close() clears the guard so the same @ run can reopen", async () => {
		const source = mentionSource([note("Agent Console")]);
		const { result } = renderHook(() => usePicker(source));
		await act(async () => {
			await result.current.updateSuggestions("@agent", 6);
		});
		// close() (not dismiss) clears the guard ref.
		act(() => result.current.close());
		expect(result.current.isOpen).toBe(false);
		// Re-detecting the same run reopens (no guard).
		await act(async () => {
			await result.current.updateSuggestions("@agent", 6);
		});
		expect(result.current.isOpen).toBe(true);
	});

	it("selectSuggestion returns the rewritten text and closes", async () => {
		const source = mentionSource([note("Alpha")]);
		const { result } = renderHook(() => usePicker(source));
		await act(async () => {
			await result.current.updateSuggestions("@al", 3);
		});
		let out = "";
		act(() => {
			out = result.current.selectSuggestion("@al", note("Alpha"));
		});
		expect(out).toBe(" @[[Alpha]] ");
		expect(result.current.isOpen).toBe(false);
	});

	it("exposes a create row only for sources that declare one", () => {
		const slash = renderHook(() => usePicker(makeSlashSource([cmd("a")])));
		act(() => slash.result.current.updateSuggestions("/a", 2));
		expect(slash.result.current.createRow).toBeNull();
	});
});

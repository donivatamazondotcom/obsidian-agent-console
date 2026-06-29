/**
 * useSuggestions — mention Esc dismiss guard.
 *
 * With multi-word @ queries (spaces allowed), Esc must dismiss the dropdown
 * AND keep it closed for the current @ run, otherwise the next keystroke
 * re-detects the same mention and reopens it. It reopens only when a different
 * @ becomes the active mention or the caret leaves the mention.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSuggestions } from "../useSuggestions";
import type { IVaultAccess, NoteMetadata } from "../../services/vault-service";
import type AgentClientPlugin from "../../plugin";

const note = (name: string): NoteMetadata => ({
	path: `${name}.md`,
	name,
	extension: "md",
	created: 0,
	modified: 0,
});

function makeVault(notes: NoteMetadata[]): IVaultAccess {
	return {
		readNote: vi.fn(),
		searchNotes: vi.fn(async () => notes),
		getActiveNote: vi.fn(async () => null),
		listNotes: vi.fn(async () => notes),
	} as unknown as IVaultAccess;
}

const plugin = {} as AgentClientPlugin;

describe("useSuggestions — mention Esc dismiss guard", () => {
	it("opens the dropdown for a multi-word @ query", async () => {
		const vault = makeVault([note("Agent Console")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@agent con", 10);
		});
		expect(result.current.mentions.isOpen).toBe(true);
		expect(result.current.mentions.suggestions).toHaveLength(1);
	});

	it("stays closed for the same @ run after dismiss(), reopens for a new @", async () => {
		const vault = makeVault([note("Agent Console")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@agent con", 10);
		});
		expect(result.current.mentions.isOpen).toBe(true);

		act(() => {
			result.current.mentions.dismiss();
		});
		expect(result.current.mentions.isOpen).toBe(false);

		// More typing within the SAME run stays closed.
		await act(async () => {
			await result.current.mentions.updateSuggestions("@agent cons", 11);
		});
		expect(result.current.mentions.isOpen).toBe(false);

		// A new @ at a different start reopens.
		await act(async () => {
			await result.current.mentions.updateSuggestions(
				"@agent cons @ag",
				15,
			);
		});
		expect(result.current.mentions.isOpen).toBe(true);
	});

	it("clears the guard when the caret leaves the mention, reopening on a fresh @", async () => {
		const vault = makeVault([note("Agent Console")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@agent", 6);
		});
		act(() => result.current.mentions.dismiss());
		expect(result.current.mentions.isOpen).toBe(false);

		// Caret no longer in a mention (no @ before cursor).
		await act(async () => {
			await result.current.mentions.updateSuggestions("plain text", 10);
		});
		expect(result.current.mentions.isOpen).toBe(false);

		// Fresh @ opens again.
		await act(async () => {
			await result.current.mentions.updateSuggestions("plain text @a", 13);
		});
		expect(result.current.mentions.isOpen).toBe(true);
	});
});

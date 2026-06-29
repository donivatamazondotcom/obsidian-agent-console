/**
 * useSuggestions — ActivePicker resolution (Unified Picker Tier 2).
 *
 * The hook priority-resolves the single open source (quick-prompt > slash >
 * mention) into one `ResolvedPicker`, so InputArea's keyboard handler routes
 * through one object instead of a 3-way ladder. These tests pin the behavior
 * the collapsed ladder relies on:
 *   - priority order + fall-through as sources close
 *   - per-source key capabilities (Shift+Enter dismiss; Enter scope combos)
 *   - navigation policy preserved per source (mention/slash clamp; ! wraps)
 *   - dismiss routing (mention keeps its @-run guard; slash/! close)
 *
 * Spec: [[Unified Picker Control]] (Tier 2 — collapse the keyboard ladder).
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSuggestions } from "../useSuggestions";
import type { IVaultAccess, NoteMetadata } from "../../services/vault-service";
import type AgentClientPlugin from "../../plugin";
import type { SlashCommand } from "../../types/session";
import type { QuickPrompt } from "../../types/quick-prompt";
import type { QuickPromptLibrary } from "../../services/quick-prompts";

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

const cmd = (name: string): SlashCommand => ({
	name,
	description: `${name} command`,
});

const prompt = (id: string, label: string): QuickPrompt => ({
	id,
	label,
	body: `body ${label}`,
	path: `prompts/${id}.md`,
	usesSelection: false,
});

function makeLibrary(prompts: QuickPrompt[]): QuickPromptLibrary {
	return {
		getPrompts: () => prompts,
		subscribe: () => () => undefined,
	} as unknown as QuickPromptLibrary;
}

describe("useSuggestions — ActivePicker resolution (Tier 2)", () => {
	it("is null when no source is open", () => {
		const vault = makeVault([]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		expect(result.current.activePicker).toBeNull();
	});

	it("resolves the mention source with its capabilities + items", async () => {
		const vault = makeVault([note("Alpha"), note("Beta")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@a", 2);
		});
		const p = result.current.activePicker;
		expect(p?.kind).toBe("mention");
		expect(p?.isOpen).toBe(true);
		expect(p?.items.map((i) => i.title)).toEqual(["Alpha", "Beta"]);
		expect(p?.selectedIndex).toBe(0);
		// mention: Shift+Enter dismisses; does NOT own Enter scope combos.
		expect(p?.capabilities).toEqual({
			dismissOnShiftEnter: true,
			ownsEnterScopeCombos: false,
		});
	});

	it("resolves the slash source with no special key capabilities", () => {
		const vault = makeVault([]);
		const commands = [cmd("help"), cmd("clear")];
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, commands, true),
		);
		act(() => {
			result.current.commands.updateSuggestions("/he", 3);
		});
		const p = result.current.activePicker;
		expect(p?.kind).toBe("slash");
		expect(p?.items.map((i) => i.title)).toEqual(["/help"]);
		expect(p?.capabilities).toEqual({
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: false,
		});
	});

	it("resolves the quick-prompt source and declares it owns Enter scope combos", () => {
		const vault = makeVault([]);
		const library = makeLibrary([prompt("debrief", "Debrief")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true, library),
		);
		act(() => {
			result.current.quickPrompts.updateSuggestions("!de", 3);
		});
		const p = result.current.activePicker;
		expect(p?.kind).toBe("quick-prompt");
		// quick-prompt: owns ⌥/⌘/⌘⌥/⌘⌥⇧+Enter combos; no Shift+Enter dismiss.
		expect(p?.capabilities).toEqual({
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: true,
		});
	});

	it("honors priority (quick-prompt > slash > mention) and falls through as sources close", async () => {
		const vault = makeVault([note("Alpha")]);
		const commands = [cmd("help")];
		const library = makeLibrary([prompt("debrief", "Debrief")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, commands, true, library),
		);

		// Open all three (synthetic — exercises the resolver's priority order).
		await act(async () => {
			await result.current.mentions.updateSuggestions("@a", 2);
		});
		act(() => result.current.commands.updateSuggestions("/he", 3));
		act(() => result.current.quickPrompts.updateSuggestions("!de", 3));
		expect(result.current.activePicker?.kind).toBe("quick-prompt");

		// Close quick-prompt → slash wins.
		act(() => result.current.quickPrompts.close());
		expect(result.current.activePicker?.kind).toBe("slash");

		// Close slash → mention wins.
		act(() => result.current.commands.close());
		expect(result.current.activePicker?.kind).toBe("mention");

		// Close mention → nothing open.
		act(() => result.current.mentions.close());
		expect(result.current.activePicker).toBeNull();
	});

	it("preserves mention nav as CLAMP (no wrap at the ends)", async () => {
		const vault = makeVault([note("Alpha"), note("Beta")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@a", 2);
		});
		// Up from index 0 clamps at 0 (does NOT wrap to the last row).
		act(() => result.current.activePicker?.navigate("up"));
		expect(result.current.activePicker?.selectedIndex).toBe(0);
		// Down advances, then clamps at the last index.
		act(() => result.current.activePicker?.navigate("down"));
		expect(result.current.activePicker?.selectedIndex).toBe(1);
		act(() => result.current.activePicker?.navigate("down"));
		expect(result.current.activePicker?.selectedIndex).toBe(1);
	});

	it("preserves quick-prompt nav as WRAP (circular around the create row)", () => {
		const vault = makeVault([]);
		const library = makeLibrary([prompt("debrief", "Debrief")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true, library),
		);
		act(() => result.current.quickPrompts.updateSuggestions("!de", 3));
		// 1 ranked prompt (index 0) + always-present create row (index 1).
		expect(result.current.activePicker?.selectedIndex).toBe(0);
		// Up from the top wraps to the last (create) row.
		act(() => result.current.activePicker?.navigate("up"));
		expect(result.current.activePicker?.selectedIndex).toBe(1);
		// Down from the last row wraps back to the top.
		act(() => result.current.activePicker?.navigate("down"));
		expect(result.current.activePicker?.selectedIndex).toBe(0);
	});

	it("routes dismiss to the mention @-run guard (stays closed for the run)", async () => {
		const vault = makeVault([note("Alpha")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true),
		);
		await act(async () => {
			await result.current.mentions.updateSuggestions("@a", 2);
		});
		expect(result.current.activePicker?.kind).toBe("mention");

		// dismiss() via the resolved picker = mention's run-dismiss guard.
		act(() => result.current.activePicker?.dismiss());
		expect(result.current.activePicker).toBeNull();
		expect(result.current.mentions.isOpen).toBe(false);

		// More typing within the SAME @ run stays closed.
		await act(async () => {
			await result.current.mentions.updateSuggestions("@al", 3);
		});
		expect(result.current.activePicker).toBeNull();
	});

	it("routes dismiss to a plain close for quick-prompt", () => {
		const vault = makeVault([]);
		const library = makeLibrary([prompt("debrief", "Debrief")]);
		const { result } = renderHook(() =>
			useSuggestions(vault, plugin, [], true, library),
		);
		act(() => result.current.quickPrompts.updateSuggestions("!de", 3));
		expect(result.current.activePicker?.kind).toBe("quick-prompt");
		act(() => result.current.activePicker?.dismiss());
		expect(result.current.activePicker).toBeNull();
		expect(result.current.quickPrompts.isOpen).toBe(false);
	});
});

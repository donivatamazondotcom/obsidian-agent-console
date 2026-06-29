/**
 * QP-I14 — `isQuickPromptScopeCombo` partitions Enter keydowns into the set
 * Obsidian's default editor hotkeys steal (⌥ / ⌘ / ⌘⌥ / ⌘⌥⇧ + Enter — claimed
 * by a pushed Scope while the `!` dropdown is open) vs the set that reaches the
 * composer's React handler normally (plain Enter, ⌘⇧Enter).
 *
 * The Scope wiring itself (against Obsidian's keymap) has no clean jsdom harness
 * and is verified by the human studio smoke test (T15/T30 precedent); this pure
 * predicate is the regression seam guarding the partition.
 */
import { describe, it, expect } from "vitest";
import { isQuickPromptScopeCombo } from "../quick-prompt-gesture";

function combo(init: {
	altKey?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
}) {
	return {
		altKey: false,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		...init,
	};
}

describe("isQuickPromptScopeCombo (QP-I14)", () => {
	it("claims ⌥Enter (editor:follow-link)", () => {
		expect(isQuickPromptScopeCombo(combo({ altKey: true }))).toBe(true);
	});

	it("claims ⌘Enter (editor:open-link-in-new-leaf)", () => {
		expect(isQuickPromptScopeCombo(combo({ metaKey: true }))).toBe(true);
	});

	it("claims ⌘⌥Enter (editor:open-link-in-new-split)", () => {
		expect(
			isQuickPromptScopeCombo(combo({ metaKey: true, altKey: true })),
		).toBe(true);
	});

	it("claims ⌘⌥⇧Enter (editor:open-link-in-new-window)", () => {
		expect(
			isQuickPromptScopeCombo(
				combo({ metaKey: true, altKey: true, shiftKey: true }),
			),
		).toBe(true);
	});

	it("claims Ctrl+Enter (Windows/Linux Mod)", () => {
		expect(isQuickPromptScopeCombo(combo({ ctrlKey: true }))).toBe(true);
	});

	it("does NOT claim plain Enter (reaches React)", () => {
		expect(isQuickPromptScopeCombo(combo({}))).toBe(false);
	});

	it("does NOT claim ⌘⇧Enter (unbound by Obsidian — reaches React)", () => {
		expect(
			isQuickPromptScopeCombo(combo({ metaKey: true, shiftKey: true })),
		).toBe(false);
	});

	it("does NOT claim ⌃⇧Enter (Windows/Linux ⌘⇧ equivalent — reaches React)", () => {
		expect(
			isQuickPromptScopeCombo(combo({ ctrlKey: true, shiftKey: true })),
		).toBe(false);
	});
});

/**
 * Platform-aware modifier-label helper (I134).
 *
 * Verifies the displayed-hint labels and the `modCombo` joiner under BOTH
 * platform branches. The constants capture `Platform.isMacOS` at import time,
 * so each platform is exercised by re-importing the module under a fresh
 * `obsidian` mock (`vi.resetModules` + `vi.doMock`).
 *
 * The branch is macOS-vs-not, so the non-macOS expectations cover Windows AND
 * Linux alike — Linux Obsidian falls into the same branch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function loadWith(isMacOS: boolean) {
	vi.resetModules();
	vi.doMock("obsidian", () => {
		const m = { Platform: { isMacOS, isWin: !isMacOS, isLinux: false } };
		return { ...m, default: m };
	});
	return import("../platform");
}

afterEach(() => {
	vi.doUnmock("obsidian");
	vi.resetModules();
});

describe("modifier labels — macOS", () => {
	it("uses Mac glyphs and concatenates combos", async () => {
		const p = await loadWith(true);
		expect(p.MOD_KEY).toBe("⌘");
		expect(p.ALT_KEY).toBe("⌥");
		expect(p.SHIFT_KEY).toBe("⇧");
		expect(p.ENTER_KEY).toBe("↵");
		expect(p.modCombo(p.MOD_KEY, p.ENTER_KEY)).toBe("⌘↵");
		expect(p.modCombo(p.MOD_KEY, p.SHIFT_KEY, p.ENTER_KEY)).toBe("⌘⇧↵");
		expect(p.modCombo(p.ALT_KEY, p.ENTER_KEY)).toBe("⌥↵");
	});
});

describe("modifier labels — Windows/Linux", () => {
	it("uses word labels and a + separator", async () => {
		const p = await loadWith(false);
		expect(p.MOD_KEY).toBe("Ctrl");
		expect(p.ALT_KEY).toBe("Alt");
		expect(p.SHIFT_KEY).toBe("Shift");
		expect(p.ENTER_KEY).toBe("Enter");
		expect(p.modCombo(p.MOD_KEY, p.ENTER_KEY)).toBe("Ctrl+Enter");
		expect(p.modCombo(p.MOD_KEY, p.SHIFT_KEY, p.ENTER_KEY)).toBe(
			"Ctrl+Shift+Enter",
		);
		expect(p.modCombo(p.ALT_KEY, p.ENTER_KEY)).toBe("Alt+Enter");
	});
});

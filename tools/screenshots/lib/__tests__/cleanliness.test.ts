/**
 * Tests for the cleanliness asserts (rubric P7).
 *
 * Pure logic, no I/O. The orchestrator builds the probe expression, runs it in
 * the renderer via Cdp.evaluate, and throws on a non-empty verdict.
 *
 * Test contract: tools/screenshots/lib/__tests__/cleanliness.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_FORBIDDEN_SELECTORS,
	DEFAULT_FORBIDDEN_TEXT,
	resolveCleanlinessConfig,
	buildCleanlinessProbeExpression,
	evaluateCleanliness,
} from "../cleanliness";

describe("defaults", () => {
	it("forbids the verified error/notice selectors and excludes the connecting state", () => {
		expect(DEFAULT_FORBIDDEN_SELECTORS).toContain(
			".agent-client-error-overlay",
		);
		expect(DEFAULT_FORBIDDEN_SELECTORS).toContain(".agent-client-tab-error");
		expect(DEFAULT_FORBIDDEN_SELECTORS).toContain(
			".agent-client-session-history-error",
		);
		expect(DEFAULT_FORBIDDEN_SELECTORS).toContain(".notice");
		// Connecting state is a P1/P3 freshness concern (response-wait gates),
		// not P7 — and is mid-flight during screen-mode connects.
		expect(DEFAULT_FORBIDDEN_SELECTORS).not.toContain(
			".acp-header-branded-connecting",
		);
	});

	it("forbids the verified internal-name leak markers but NOT the legit agent names", () => {
		expect(DEFAULT_FORBIDDEN_TEXT).toContain("Auto-SA");
		expect(DEFAULT_FORBIDDEN_TEXT).toContain("kiro_default");
		// A blanket "kiro"/"Kiro CLI" would false-positive the legit agent picker.
		expect(DEFAULT_FORBIDDEN_TEXT).not.toContain("kiro");
		expect(DEFAULT_FORBIDDEN_TEXT).not.toContain("Kiro CLI");
	});
});

describe("resolveCleanlinessConfig", () => {
	it("returns the defaults when no per-entry additions are given", () => {
		const cfg = resolveCleanlinessConfig();
		expect(cfg.selectors).toEqual(DEFAULT_FORBIDDEN_SELECTORS);
		expect(cfg.text).toEqual(DEFAULT_FORBIDDEN_TEXT);
	});

	it("merges per-entry additions with the defaults", () => {
		const cfg = resolveCleanlinessConfig(
			[".agent-client-unrelated-leaf"],
			["SecretCodename"],
		);
		expect(cfg.selectors).toContain(".agent-client-error-overlay");
		expect(cfg.selectors).toContain(".agent-client-unrelated-leaf");
		expect(cfg.text).toContain("Auto-SA");
		expect(cfg.text).toContain("SecretCodename");
	});

	it("de-duplicates and drops empty entries", () => {
		const cfg = resolveCleanlinessConfig(
			[".notice", "  ", ".notice"],
			["Auto-SA", ""],
		);
		// .notice already in defaults — appears exactly once
		expect(cfg.selectors.filter((s) => s === ".notice")).toHaveLength(1);
		expect(cfg.selectors).not.toContain("  ");
		expect(cfg.text.filter((t) => t === "Auto-SA")).toHaveLength(1);
		expect(cfg.text).not.toContain("");
	});
});

describe("buildCleanlinessProbeExpression", () => {
	it("embeds the selector/text arrays and the targeting marker", () => {
		const expr = buildCleanlinessProbeExpression({
			selectors: [".notice"],
			text: ["Auto-SA"],
		});
		expect(expr).toContain("__cleanliness_probe__");
		expect(expr).toContain('".notice"');
		expect(expr).toContain('"Auto-SA"');
		// keys on visibility, not mere presence
		expect(expr).toContain("getClientRects");
		expect(expr).toContain("innerText");
	});
});

describe("evaluateCleanliness", () => {
	it("passes a clean probe result", () => {
		const v = evaluateCleanliness({ selectors: [], text: [] });
		expect(v.ok).toBe(true);
		expect(v.violations).toEqual([]);
	});

	it("reports a forbidden visible selector", () => {
		const v = evaluateCleanliness({
			selectors: [".agent-client-error-overlay"],
			text: [],
		});
		expect(v.ok).toBe(false);
		expect(v.violations[0]).toMatch(/forbidden element visible.*error-overlay/);
	});

	it("reports forbidden text", () => {
		const v = evaluateCleanliness({ selectors: [], text: ["Auto-SA"] });
		expect(v.ok).toBe(false);
		expect(v.violations[0]).toMatch(/forbidden text present.*Auto-SA/);
	});

	it("aggregates multiple violations", () => {
		const v = evaluateCleanliness({
			selectors: [".notice", ".agent-client-tab-error"],
			text: ["kiro_default"],
		});
		expect(v.ok).toBe(false);
		expect(v.violations).toHaveLength(3);
	});

	it("treats a null/undefined/malformed result as clean (defensive)", () => {
		expect(evaluateCleanliness(undefined).ok).toBe(true);
		expect(evaluateCleanliness(null).ok).toBe(true);
		expect(
			evaluateCleanliness({} as unknown as { selectors: string[]; text: string[] }).ok,
		).toBe(true);
	});
});

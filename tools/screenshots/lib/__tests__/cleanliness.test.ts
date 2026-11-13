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
		// The bare `.notice` is carved out for the intentional MCP OAuth sign-in
		// notice (forceMcpAuthNotice shot); stray toasts are still forbidden.
		expect(DEFAULT_FORBIDDEN_SELECTORS).toContain(
			".notice:not(:has(.agent-client-mcp-auth-notice))",
		);
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

// PR 2b: settings pages show agent paths in input values, which innerText
// never includes, and the settings path probes the settings document.
describe("buildCleanlinessProbeExpression — input values and root document", () => {
	const run = (expr: string, doc: Document) =>
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		new Function("activeDocument", `return (${expr});`)(doc) as { selectors: string[]; text: string[] };
	const shown = (el: Element) => {
		(el as HTMLElement).getClientRects = () => [{}] as unknown as DOMRectList;
	};

	it("finds forbidden text in visible input and textarea values, ignoring hidden ones", () => {
		document.body.innerHTML = `<input id="a"><textarea id="b"></textarea><input id="h">`;
		(document.getElementById("a") as HTMLInputElement).value = "/Users/me/bin/claude-agent-acp";
		(document.getElementById("b") as HTMLTextAreaElement).value = "HOME=/tmp";
		(document.getElementById("h") as HTMLInputElement).value = "AC_VIDEO_RUN=r1";
		shown(document.getElementById("a") as Element);
		shown(document.getElementById("b") as Element);
		const expr = buildCleanlinessProbeExpression({ selectors: [], text: ["/Users/", "AC_VIDEO_RUN"] }, { root: "activeDocument", inputValues: true });
		expect(run(expr, document).text).toEqual(["/Users/"]);
	});

	it("checks the option a visible <select> shows", () => {
		document.body.innerHTML = `<select id="s"><option>Claude Code</option><option selected>/Users/me/bin/x</option></select>`;
		shown(document.getElementById("s") as Element);
		const expr = buildCleanlinessProbeExpression({ selectors: [], text: ["/Users/"] }, { root: "activeDocument", inputValues: true });
		expect(run(expr, document).text).toEqual(["/Users/"]);
	});

	it("checks a <select> inside the crop on the clip path, by its option label", () => {
		document.body.innerHTML = `<select id="s"><option label="/Users/me/bin/x" selected>x</option></select>`;
		const el = document.getElementById("s") as HTMLElement;
		shown(el);
		el.getBoundingClientRect = () => ({ x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, toJSON() {} }) as DOMRect;
		const expr = buildCleanlinessProbeExpression({ selectors: [], text: ["/Users/"] }, { root: "activeDocument", inputValues: true, clip: { x: 0, y: 0, width: 600, height: 500 } });
		expect(run(expr, document).text).toEqual(["/Users/"]);
	});

	it("ignores input values unless asked (main-path entries are unchanged)", () => {
		document.body.innerHTML = `<input id="a">`;
		(document.getElementById("a") as HTMLInputElement).value = "/Users/me";
		shown(document.getElementById("a") as Element);
		const expr = buildCleanlinessProbeExpression({ selectors: [], text: ["/Users/"] }, { root: "activeDocument" });
		expect(run(expr, document).text).toEqual([]);
	});

	it("with a clip, checks only text and values inside the crop", () => {
		document.body.innerHTML = `<div id="in">Path /Users/me/a</div><div id="out">Vault /Users/me/b RUN-9</div><textarea id="t"></textarea>`;
		const at = (id: string, r: { x: number; y: number; width: number; height: number }) => {
			const el = document.getElementById(id) as HTMLElement;
			shown(el);
			el.getBoundingClientRect = () => ({ ...r, top: r.y, left: r.x, right: r.x + r.width, bottom: r.y + r.height, toJSON() {} }) as DOMRect;
		};
		at("in", { x: 10, y: 10, width: 100, height: 20 });
		at("out", { x: 10, y: 900, width: 100, height: 20 });
		at("t", { x: 10, y: 40, width: 100, height: 20 });
		(document.getElementById("t") as HTMLTextAreaElement).value = "HOME=/home/me";
		const expr = buildCleanlinessProbeExpression(
			{ selectors: [], text: ["/Users/me/a", "/Users/me/b", "RUN-9", "/home/"] },
			{ root: "activeDocument", inputValues: true, clip: { x: 0, y: 0, width: 600, height: 500 } },
		);
		expect(run(expr, document).text).toEqual(["/Users/me/a", "/home/"]);
	});

	it("probes the main document by default", () => {
		const expr = buildCleanlinessProbeExpression({ selectors: [], text: ["x"] });
		expect(expr).toContain("const root = document;");
		expect(expr).not.toContain("activeDocument");
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

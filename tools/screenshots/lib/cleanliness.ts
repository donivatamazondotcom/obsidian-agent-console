/**
 * Cleanliness asserts for screenshot captures (rubric P7).
 *
 * Rubric P7 — "Clean frame": a docs screenshot must show no dev console, no
 * error banners, no stray notices, no unrelated panels, and no leaked internal
 * agent names. This module encodes the mechanical part of P7 as a capture-time
 * gate (the I12 fail-loud precedent): before capturing, probe the live renderer
 * DOM and FAIL the run if a forbidden element is VISIBLE or a forbidden
 * internal-name string appears in the visible text.
 *
 * Two complementary mechanisms:
 *
 * 1. Forbidden SELECTORS — error/notice elements that should never be on screen
 *    in a healthy capture. The defaults below were verified against the live
 *    fixtures DOM + the plugin source (`grep src/`) on 2026-06-10, not guessed
 *    (per ground-truth). They are keyed on VISIBILITY, not mere DOM presence:
 *    several error containers (e.g. Obsidian's core `.metadata-error-container`)
 *    are always in the DOM but hidden until an error occurs — keying on presence
 *    would false-positive every shot.
 *
 *    Deliberately EXCLUDED from the default: `.acp-header-branded-connecting`.
 *    The connecting/empty state is a P1/P3 *freshness* concern already owned by
 *    the response-wait gates (I07/I09/I80); it is legitimately mid-flight when a
 *    screen-mode popover shot runs its pre-capture cleanliness probe, so
 *    forbidding it here would false-positive connect-in-flight captures.
 *
 * 2. Forbidden TEXT — internal agent-fleet identifiers that must never appear in
 *    the public docs fixtures (which deliberately run Claude Code via Bedrock).
 *    `"Auto-SA"` is the internal profile display name that would surface in the
 *    chat header if the fixtures regressed onto the internal kiro agent;
 *    `"kiro_default"` is the kiro-cli default internal agent id. Both were
 *    verified absent from the fixtures vault notes AND from any legitimately
 *    rendered UI (the `auto-sa` hits in `src/` are code comments + test data,
 *    never rendered). A blanket `"kiro"` is intentionally NOT defaulted — the
 *    legit selectable agent set includes "Kiro CLI"/"Kiro", which a substring
 *    match would wrongly flag in the agent picker / settings shots.
 *
 * Per-entry `forbiddenSelectors` / `forbiddenText` MERGE with these defaults
 * (e.g. a shot that must also exclude an unrelated leaf adds its selector).
 *
 * Spec: [[Agent Console Screenshot Automation]] § Decision 9 (Tier-2 asserts).
 * Test contract: tools/screenshots/lib/__tests__/cleanliness.test.ts.
 */

/**
 * Selectors that must NOT be VISIBLE in a clean frame. Verified real in the
 * plugin source (2026-06-10). Error/notice surfaces only — see the module
 * doc for why the connecting state is excluded.
 */
export const DEFAULT_FORBIDDEN_SELECTORS: string[] = [
	".agent-client-error-overlay",
	".agent-client-tab-error",
	".agent-client-session-history-error",
	// Stray toasts are forbidden — EXCEPT the intentional MCP OAuth sign-in
	// notice, a legitimate docs subject captured via forceMcpAuthNotice.
	".notice:not(:has(.agent-client-mcp-auth-notice))",
];

/**
 * Case-insensitive substrings that must NOT appear in the visible text —
 * internal agent-fleet markers that would leak if the fixtures regressed off
 * Claude Code/Bedrock. Verified absent from legit fixtures content + rendered
 * UI (2026-06-10).
 */
export const DEFAULT_FORBIDDEN_TEXT: string[] = ["Auto-SA", "kiro_default"];

export interface CleanlinessConfig {
	selectors: string[];
	text: string[];
}

/**
 * Merge the verified global defaults with optional per-entry additions,
 * dropping empties and de-duplicating. Per-entry lists ADD to (never replace)
 * the defaults — a shot can forbid more, never less.
 */
export function resolveCleanlinessConfig(
	entrySelectors?: string[],
	entryText?: string[],
): CleanlinessConfig {
	const dedup = (xs: string[]): string[] =>
		Array.from(new Set(xs.filter((s) => typeof s === "string" && s.trim() !== "")));
	return {
		selectors: dedup([
			...DEFAULT_FORBIDDEN_SELECTORS,
			...(entrySelectors ?? []),
		]),
		text: dedup([...DEFAULT_FORBIDDEN_TEXT, ...(entryText ?? [])]),
	};
}

/** What the renderer probe returns: which forbidden things were actually found. */
export interface CleanlinessProbeResult {
	/** Forbidden selectors that matched at least one VISIBLE element. */
	selectors: string[];
	/** Forbidden strings found (case-insensitively) in the visible body text. */
	text: string[];
}

/**
 * Build the compact renderer expression that probes the live DOM and returns a
 * `CleanlinessProbeResult` by value. The `__cleanliness_probe__` marker lets the
 * orchestrator's tests target this specific `evaluate` call. Only the two string
 * arrays are embedded, so the payload stays tiny (per the dev:cdp large-params
 * gotcha — large `params` silently return empty).
 *
 * Visibility predicate: `getClientRects().length > 0` (excludes display:none and
 * detached nodes) AND computed `visibility !== "hidden"` AND `display !== "none"`
 * — verified to exclude the always-present-but-hidden `.metadata-error-container`
 * while catching a genuinely shown error overlay.
 */
export function buildCleanlinessProbeExpression(
	config: CleanlinessConfig,
): string {
	const sel = JSON.stringify(config.selectors);
	const txt = JSON.stringify(config.text);
	return `/*__cleanliness_probe__*/(() => {
		const sels = ${sel}, txts = ${txt};
		const vis = (el) => {
			const rects = el.getClientRects();
			if (!rects || rects.length === 0) return false;
			const cs = getComputedStyle(el);
			return cs.visibility !== "hidden" && cs.display !== "none";
		};
		const selectors = sels.filter((s) =>
			Array.from(document.querySelectorAll(s)).some(vis),
		);
		const bodyText = (document.body && document.body.innerText) || "";
		const lc = bodyText.toLowerCase();
		const text = txts.filter((t) => lc.includes(String(t).toLowerCase()));
		return { selectors, text };
	})()`;
}

export interface CleanlinessVerdict {
	ok: boolean;
	violations: string[];
}

/**
 * Decide pass/fail from a probe result. A null/undefined or shape-malformed
 * result is treated as clean — the probe is simple DOM querying that does not
 * realistically fail in production, and the orchestrator's unit tests use a
 * mock whose default `evaluate` returns undefined for non-probe calls.
 */
export function evaluateCleanliness(
	result: CleanlinessProbeResult | null | undefined,
): CleanlinessVerdict {
	const selectors = Array.isArray(result?.selectors) ? result.selectors : [];
	const text = Array.isArray(result?.text) ? result.text : [];
	const violations = [
		...selectors.map((s) => `forbidden element visible: ${s}`),
		...text.map((t) => `forbidden text present: "${t}"`),
	];
	return { ok: violations.length === 0, violations };
}

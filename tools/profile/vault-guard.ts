/**
 * GB-T03: which vault the profiler may attach to. The profiler hard-reloads
 * the attached vault several times per run, which tears down every live
 * agent session in it, so only disposable vaults qualify: `studio` and
 * `ST-*`, the same rule as `tools/invariant-suite/run.ts` `isAllowedVault`.
 * The attached vault must also be the one requested, and seedable at its
 * own base path, so the vault that is measured is the vault that is seeded.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */

export interface ProfileTarget {
	/** The `--vault` the user asked for. */
	requested: string;
	/** `app.vault.getName()` of the vault `dev:cdp` actually attached to. */
	resolvedName: string;
	/** `app.vault.adapter.getBasePath()` of that vault. */
	basePath: string;
}

export function isDisposableVault(name: string): boolean {
	return name === "studio" || name.startsWith("ST-");
}

/**
 * Null when the profiler may run against `t`; otherwise the reason it must
 * not. `missing(basePath)` names a file the vault lacks for profiling (the
 * plugin's seed template, or the profiler's helper plugin), else null.
 */
export function checkProfileTarget(
	t: ProfileTarget,
	missing: (basePath: string) => string | null,
): string | null {
	if (!t.resolvedName) {
		return `could not resolve the attached vault's name for --vault=${t.requested}`;
	}
	if (!isDisposableVault(t.resolvedName)) {
		return `vault "${t.resolvedName}" is not a disposable profile vault (studio or ST-*); profiling hard-reloads it and tears down its live agent sessions`;
	}
	if (t.resolvedName !== t.requested) {
		return `attached vault "${t.resolvedName}" is not the requested --vault=${t.requested}`;
	}
	if (!t.basePath) {
		return `could not read the base path of vault "${t.resolvedName}"`;
	}
	const lack = missing(t.basePath);
	if (lack) {
		return `no ${lack} in the config folder of ${t.basePath}; the profiler seeds the vault it measures and times cold start through its helper plugin (respawn ST studios made before the helper existed)`;
	}
	return null;
}

/**
 * Null when the page was visible; otherwise why the run can't count. A
 * hidden page (screen locked, window minimized or fully covered) renders no
 * frames: no scroll events, no long-animation-frame entries, throttled
 * timers. Its numbers are not comparable with a visible run, so such a run
 * is incomplete even when every scenario returned.
 */
export function visibilityProblem(states: string[]): string | null {
	const hidden = states.filter((s) => s !== "visible");
	if (hidden.length === 0) return null;
	return `the vault's page was ${hidden[0]} during the run (screen locked, window minimized or covered); hidden pages render no frames, so its numbers are not comparable`;
}

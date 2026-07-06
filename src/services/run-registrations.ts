/**
 * Guarded registration harness (I157 follow-on: onload resilience).
 *
 * Runs each `onload` registration as an isolated step so that a single failing
 * registration — e.g. a view type or command id that collides with another
 * plugin — CANNOT abort `onload` and take the whole plugin down. That total,
 * silent abort is what made I157 catastrophic for new-user onboarding: one
 * throwing `registerView` meant no panel, no commands, nothing. With the
 * harness, a failing step is logged and reported in one consolidated notice,
 * and every other registration still runs (the plugin loads degraded, not dead).
 *
 * Pure and dependency-injected so it is fully unit-testable without booting the
 * plugin — the regression guard for the "plugin silently fails to start" class
 * lives in the cheap unit layer, not an E2E harness.
 */
export interface RegistrationStep {
	/** Human-readable, user-facing label (shown in the failure notice). */
	label: string;
	run: () => void;
}

export interface RegistrationDeps {
	notify: (message: string) => void;
	logError: (message: string, error: unknown) => void;
}

export interface RegistrationResult {
	ok: string[];
	failed: string[];
}

export function runRegistrations(
	steps: RegistrationStep[],
	deps: RegistrationDeps,
): RegistrationResult {
	const ok: string[] = [];
	const failed: string[] = [];
	for (const step of steps) {
		try {
			step.run();
			ok.push(step.label);
		} catch (error) {
			failed.push(step.label);
			deps.logError(`Registration "${step.label}" failed`, error);
		}
	}
	if (failed.length > 0) {
		deps.notify(
			`Agent Console loaded, but these parts are unavailable: ` +
				`${failed.join(", ")}. Try reloading Obsidian; if it keeps ` +
				`happening, another plugin may be conflicting.`,
		);
	}
	return { ok, failed };
}

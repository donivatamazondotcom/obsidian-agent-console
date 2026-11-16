/**
 * Why a profile run can't count. Pure, so the decision that gates every
 * write (history point, baseline, golden anchor) is unit-tested. An empty
 * result means the run is complete.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
import { missingFromProfile, type Baseline, type Profile } from "./baseline";
import { visibilityProblem } from "./vault-guard";

export interface ScenarioFailure {
	pass: number;
	scenario: string;
	error: string;
}

export interface RunFacts {
	profile: Profile;
	baseline: Baseline | null;
	/** Scenario ids defined now (a retired baseline scenario isn't "missing"). */
	known: readonly string[];
	failures: ScenarioFailure[];
	/** document.visibilityState read after each scenario. */
	visibility: string[];
	buildHashBefore: string;
	buildHashAfter: string;
}

export function incompleteReasons(f: RunFacts): string[] {
	const hidden = visibilityProblem(f.visibility);
	return [
		...(hidden ? [hidden] : []),
		...(f.buildHashBefore !== f.buildHashAfter
			? [`main.js changed during the run (${f.buildHashBefore} -> ${f.buildHashAfter}); rebuild, then rerun`]
			: []),
		...f.failures.map((x) => `pass ${x.pass}: ${x.scenario} failed — ${x.error}`),
		...missingFromProfile(f.profile, f.baseline, f.known).map((s) => `${s}: in the baseline but not measured`),
	];
}

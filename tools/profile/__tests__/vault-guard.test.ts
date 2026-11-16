/**
 * The profiler hard-reloads the attached vault several times, which tears
 * down every live agent session in it. The guard allows only disposable
 * vaults (`studio`, `ST-*`, the invariant suite's rule), requires the
 * attached vault to be the one requested, and requires it to be seedable
 * at its own base path, so the vault that is measured is the vault that
 * was seeded.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2 (GB-T03).
 */
import { describe, it, expect } from "vitest";
import { checkProfileTarget, visibilityProblem } from "../vault-guard";

const seedable = () => true;

describe("checkProfileTarget", () => {
	it("allows studio and ST-* vaults that match the request", () => {
		expect(
			checkProfileTarget(
				{ requested: "studio", resolvedName: "studio", basePath: "/x/studio" },
				seedable,
			),
		).toBeNull();
		expect(
			checkProfileTarget(
				{ requested: "ST-foo", resolvedName: "ST-foo", basePath: "/x/ST-foo" },
				seedable,
			),
		).toBeNull();
	});

	it("refuses any other vault name, not just one", () => {
		for (const name of ["donivatamazondotcom", "notes", "Studio", "work"]) {
			expect(
				checkProfileTarget(
					{ requested: name, resolvedName: name, basePath: `/x/${name}` },
					seedable,
				),
			).toMatch(/disposable/);
		}
	});

	it("refuses an unresolved vault name", () => {
		expect(
			checkProfileTarget(
				{ requested: "studio", resolvedName: "", basePath: "/x/studio" },
				seedable,
			),
		).toMatch(/resolve/);
	});

	it("refuses when the attached vault is not the requested one", () => {
		expect(
			checkProfileTarget(
				{ requested: "studio", resolvedName: "ST-foo", basePath: "/x/ST-foo" },
				seedable,
			),
		).toMatch(/requested/);
	});

	it("refuses a vault it cannot seed at its own base path", () => {
		expect(
			checkProfileTarget(
				{ requested: "studio", resolvedName: "studio", basePath: "" },
				seedable,
			),
		).toMatch(/base path/);
		expect(
			checkProfileTarget(
				{ requested: "studio", resolvedName: "studio", basePath: "/x/studio" },
				() => false,
			),
		).toMatch(/data\.template\.json/);
	});
});

describe("visibilityProblem", () => {
	it("passes a run whose page stayed visible", () => {
		expect(visibilityProblem(["visible", "visible"])).toBeNull();
	});

	it("fails a run whose page was hidden at any check", () => {
		expect(visibilityProblem(["visible", "hidden"])).toMatch(/hidden/);
		expect(visibilityProblem(["hidden"])).toMatch(/no frames/);
	});
});

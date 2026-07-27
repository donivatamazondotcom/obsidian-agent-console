/**
 * Runtime-dependency hygiene guard — every `dependencies` entry must actually
 * be reachable from the shipped bundle.
 *
 * Regression guard for the class of problem where a **build-only** package sits
 * in `dependencies` instead of `devDependencies`. Nothing in the normal build
 * catches it: esbuild bundles only the `src/main.ts` TypeScript graph, so a
 * package imported exclusively by `tools/**` never reaches `main.js` and the
 * build stays green either way. But `dependencies` is what supply-chain
 * scanners read as "this ships to users" — so a misplaced build-only package
 * makes the plugin *look* like it ships code it does not, and any advisory
 * against that package is reported against the shipped artifact.
 *
 * Root-cause incident (2026-07-27): `sharp` (used only by
 * `tools/screenshots/**` to crop/encode docs images) sat in `dependencies`.
 * A libvips advisory against it (GHSA-f88m-g3jw-g9cj) was therefore attributed
 * to the plugin during automated Obsidian store review, contributing to a
 * "Caution" flag — even though the built `main.js` contains no `sharp`
 * reference at all. The misplacement was the bug; the vulnerability was
 * incidental. See the I178 RCA.
 *
 * The invariant asserted here is intentionally mechanical and discovery-based
 * (`git ls-files`, so it respects .gitignore and auto-covers any dependency
 * added in future): for every package in `dependencies`, at least one tracked
 * non-test file under `src/` must import it. A package no `src/` file imports
 * cannot be in the shipped graph, so it belongs in `devDependencies`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();

const pkg = JSON.parse(
	readFileSync(resolve(repoRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

const runtimeDeps = Object.keys(pkg.dependencies ?? {}).sort();

/** Tracked, non-test TS/TSX under `src/` — the files esbuild can actually reach. */
const srcFiles = execSync("git ls-files 'src/*.ts' 'src/*.tsx' 'src/**/*.ts' 'src/**/*.tsx'", {
	cwd: repoRoot,
	encoding: "utf8",
})
	.split("\n")
	.map((s) => s.trim())
	.filter(Boolean)
	.filter((f) => !f.includes("__tests__") && !f.includes("__test_stubs__"));

/**
 * Reduce an import specifier to its package name:
 * `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`. Relative paths -> null.
 */
function packageNameOf(specifier: string): string | null {
	if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Every bare package imported (static, side-effect, dynamic, or require) from `src/`. */
const importedPackages = new Set<string>();
const SPECIFIER_RE =
	/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

for (const rel of srcFiles) {
	const source = readFileSync(resolve(repoRoot, rel), "utf8");
	for (const match of source.matchAll(SPECIFIER_RE)) {
		const name = packageNameOf(match[1]);
		if (name) importedPackages.add(name);
	}
}

describe("runtime dependencies are reachable from the shipped bundle", () => {
	it("discovery found src files and resolved their imports (sanity check)", () => {
		// Guards against a silently-empty discovery (e.g. git unavailable) that
		// would make the per-dependency checks vacuously pass.
		expect(srcFiles.length).toBeGreaterThan(50);
		expect(importedPackages).toContain("react");
		expect(runtimeDeps.length).toBeGreaterThan(0);
	});

	it.each(runtimeDeps)(
		"%s — imported by at least one src/ file (else it belongs in devDependencies)",
		(dep) => {
			expect({ dep, importedFromSrc: importedPackages.has(dep) }).toEqual({
				dep,
				importedFromSrc: true,
			});
		},
	);

	it("no build-only tooling package is declared as a runtime dependency", () => {
		// `sharp` is the concrete incident (I178): imported only by
		// tools/screenshots/**. Listed explicitly so the intent survives even if
		// the discovery above is ever loosened.
		expect(runtimeDeps).not.toContain("sharp");
	});
});

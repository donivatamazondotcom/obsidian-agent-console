import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration for unit tests.
 *
 * Test files live alongside source under `src/**\/__tests__/*.test.ts(x)`.
 * JSDOM environment provides DOM globals for React hook tests.
 *
 * The `obsidian` alias points at a minimal stub because the real `obsidian`
 * npm package is types-only (no runtime). Production builds resolve
 * `obsidian` via Obsidian's own runtime; tests resolve it via the stub at
 * `src/__test_stubs__/obsidian.ts`. Tests that need stricter assertions on
 * Obsidian API behavior should `vi.mock("obsidian", ...)` inline.
 *
 * See [[ACP Scroll Architecture Rework]] for the broader test strategy.
 */
export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(
				__dirname,
				"src/__test_stubs__/obsidian.ts",
			),
		},
	},
	test: {
		environment: "jsdom",
		// Benchmarks: explicit src-only include. Without it vitest's default
		// bench glob walks .trees/** git worktrees, and because the perf gate
		// keys results by benchmark NAME, a worktree's copy of a benchmark
		// silently OVERWRITES the main checkout's measurement — the gate can
		// end up diffing another branch's code against the baseline.
		benchmark: {
			include: ["src/**/__benchmarks__/**/*.bench.ts"],
		},
		globals: false,
		include: [
			"src/**/__tests__/**/*.test.{ts,tsx}",
			"tools/**/__tests__/**/*.test.{ts,tsx}",
		],
		// Each test gets a clean DOM. Vitest defaults to per-file isolation
		// which is sufficient for our hook-level tests.
		setupFiles: ["src/__test_stubs__/vitest.setup.ts"],
	},
});

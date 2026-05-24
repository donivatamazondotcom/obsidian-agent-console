import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for unit tests.
 *
 * Test files live alongside source under `src/**\/__tests__/*.test.ts(x)`.
 * JSDOM environment provides DOM globals for React hook tests.
 *
 * See [[ACP Scroll Architecture Rework]] for the broader test strategy.
 */
export default defineConfig({
	test: {
		environment: "jsdom",
		globals: false,
		include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
		// Each test gets a clean DOM. Vitest defaults to per-file isolation
		// which is sufficient for our hook-level tests.
		setupFiles: [],
	},
});

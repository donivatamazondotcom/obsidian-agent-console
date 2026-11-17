import baseConfig from "./vitest.config";

/**
 * Vitest config for Stryker mutation runs (stryker.config.json →
 * vitest.configFile).
 *
 * Stryker's vitest runner forces `pool: "threads"`, and Node's worker
 * threads reject V8 flags such as --max-old-space-size in execArgv
 * (ERR_WORKER_INVALID_EXEC_ARGV), so the base config's fork-only execArgv
 * would stop every worker from starting. Thread workers need no orphan
 * guard: they die with their process. `mergeConfig` is not used because it
 * concatenates arrays, which would keep the flags.
 */
export default {
	...baseConfig,
	test: { ...baseConfig.test, execArgv: [] },
};

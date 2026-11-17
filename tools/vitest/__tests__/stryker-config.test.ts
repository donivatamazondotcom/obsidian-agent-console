import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(__dirname, "../../..");

interface LoadedConfig {
	test?: { pool?: string; execArgv?: string[] };
}

async function loadVitestConfig(file: string): Promise<LoadedConfig> {
	const mod = (await import(pathToFileURL(path.join(ROOT, file)).href)) as {
		default: LoadedConfig;
	};
	return mod.default;
}

// Stryker's vitest runner forces `pool: "threads"`. Node's worker threads
// reject V8 flags such as --max-old-space-size in execArgv
// (ERR_WORKER_INVALID_EXEC_ARGV), so every mutation run fails to start a
// worker if the config Stryker loads passes the fork-only flags through.
describe("Stryker vitest config", () => {
	it("passes no execArgv to worker threads", async () => {
		const stryker = JSON.parse(
			readFileSync(path.join(ROOT, "stryker.config.json"), "utf8"),
		) as { vitest: { configFile: string } };
		const config = await loadVitestConfig(stryker.vitest.configFile);
		// Empty, not just "no --max-*": threads reject other flags too, and
		// Stryker's sandbox omits tools/, so a --require of the guard fails.
		expect(config.test?.execArgv ?? []).toEqual([]);
	});

	it("keeps the orphan guard and heap cap on the default fork pool", async () => {
		const config = await loadVitestConfig("vitest.config.ts");
		expect(config.test?.pool).toBe("forks");
		expect(config.test?.execArgv).toContain("--max-old-space-size=1536");
	});
});

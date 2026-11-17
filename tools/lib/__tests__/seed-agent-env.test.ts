// Per-agent env injection with a parameterized run-marker key (smoke
// instances use AC_SMOKE_RUN), and the Kiro V2 record cleanup's path guard.
// Spec: [[Isolated smoke-test instances]] § Agent environment, § Teardown.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedAgentEnv, seedScreenshotData, type SeedContext } from "../fixtures-vault";
import { cleanKiroSessionRecords } from "../isolated-instance";

const ctx: SeedContext = { runId: "st-a", realHome: "/Users/u", loginPath: "/bin:/usr/bin", resolveCommand: (c) => `/opt/bin/${c}` };
const template = {
	kiro: { command: "kiro-cli", env: [{ key: "X", value: "1" }] },
	claude: { command: "/abs/claude", env: [] },
	customAgents: [{ id: "c1", command: "foo" }],
	other: 3,
};

const envOf = (a: unknown) => (a as { env: { key: string; value: string }[] }).env;

describe("seedAgentEnv", () => {
	it("stamps HOME, PATH and the given marker key", () => {
		const d = seedAgentEnv(structuredClone(template), ctx, "AC_SMOKE_RUN");
		expect(envOf(d.kiro)).toEqual([
			{ key: "X", value: "1" },
			{ key: "HOME", value: "/Users/u" },
			{ key: "PATH", value: "/bin:/usr/bin" },
			{ key: "AC_SMOKE_RUN", value: "st-a" },
		]);
		expect((d.kiro as { command: string }).command).toBe("/opt/bin/kiro-cli");
		expect(envOf((d.customAgents as unknown[])[0]).map((e) => e.key)).toContain("AC_SMOKE_RUN");
	});
	it("defaults to AC_VIDEO_RUN and matches screenshot seeding exactly", () => {
		expect(JSON.stringify(seedAgentEnv(structuredClone(template), ctx))).toBe(JSON.stringify(seedScreenshotData(template, ctx)));
		expect(envOf(seedScreenshotData(template, ctx).kiro).map((e) => e.key)).toContain("AC_VIDEO_RUN");
	});
	it("is idempotent and re-stamps sentinel values", () => {
		const once = seedAgentEnv(structuredClone(template), ctx, "AC_SMOKE_RUN");
		const tampered = structuredClone(once);
		envOf(tampered.kiro).forEach((e) => (e.value = e.key === "X" ? e.value : "SENTINEL"));
		const again = seedAgentEnv(tampered, ctx, "AC_SMOKE_RUN");
		expect(JSON.stringify(again)).toBe(JSON.stringify(once));
	});
	it("keeps an already-absolute command", () => {
		const d = seedAgentEnv({ kiro: { command: "/old/kiro-cli" } }, ctx, "AC_SMOKE_RUN");
		expect((d.kiro as { command: string }).command).toBe("/old/kiro-cli");
	});
});

describe("cleanKiroSessionRecords", () => {
	let kiro: string;
	let base: string;
	const rec = (name: string, cwd: string | undefined) => {
		writeFileSync(path.join(kiro, "sessions/cli", `${name}.json`), JSON.stringify(cwd === undefined ? {} : { cwd }));
		writeFileSync(path.join(kiro, "sessions/cli", `${name}.jsonl`), "");
	};
	beforeEach(() => {
		base = realpathSync(mkdtempSync(path.join(tmpdir(), "kiro-clean-")));
		kiro = path.join(base, "kiro");
		mkdirSync(path.join(kiro, "sessions/cli"), { recursive: true });
	});
	afterEach(() => rmSync(base, { recursive: true, force: true }));

	it("throws on an empty root instead of matching every record", () => {
		rec("a", "/x");
		rec("b", undefined);
		expect(() => cleanKiroSessionRecords("", kiro)).toThrow(/empty/);
		expect(existsSync(path.join(kiro, "sessions/cli/a.json"))).toBe(true);
		expect(existsSync(path.join(kiro, "sessions/cli/b.json"))).toBe(true);
	});
	it("throws on a relative root", () => {
		expect(() => cleanKiroSessionRecords("studios/ST-a", kiro)).toThrow(/absolute/);
	});
	it("removes records under the root and their .jsonl, respects the prefix boundary, keeps unreadable ones", () => {
		rec("in", "/s/ST-a/notes");
		rec("exact", "/s/ST-a");
		rec("sibling", "/s/ST-ab");
		writeFileSync(path.join(kiro, "sessions/cli/bad.json"), "{not json");
		expect(cleanKiroSessionRecords("/s/ST-a", kiro).sort()).toEqual(["exact.json", "in.json"]);
		expect(existsSync(path.join(kiro, "sessions/cli/in.jsonl"))).toBe(false);
		expect(existsSync(path.join(kiro, "sessions/cli/sibling.json"))).toBe(true);
		expect(existsSync(path.join(kiro, "sessions/cli/bad.json"))).toBe(true);
	});
	it("matches the realpath form when called with it", () => {
		const real = path.join(base, "real");
		mkdirSync(path.join(real, "ST-a"), { recursive: true });
		symlinkSync(real, path.join(base, "link"));
		rec("r", path.join(real, "ST-a"));
		expect(cleanKiroSessionRecords(path.join(base, "link", "ST-a"), kiro)).toEqual([]);
		expect(cleanKiroSessionRecords(path.join(real, "ST-a"), kiro)).toEqual(["r.json"]);
	});
});

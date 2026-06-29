import { describe, it, expect } from "vitest";
import {
	buildInstallArgs,
	summarizeInstallFailure,
	installAgent,
	type InstallProcess,
	type InstallSpawn,
} from "../agent-installer";

/**
 * A fake spawn that registers the handlers synchronously (as installAgent
 * attaches them in the Promise executor), then emits a scripted sequence on a
 * microtask so the handlers are in place first.
 */
function fakeSpawn(script: {
	stdout?: string[];
	stderr?: string[];
	close?: number | null;
	error?: Error;
	throwOnSpawn?: boolean;
}): InstallSpawn {
	return () => {
		if (script.throwOnSpawn) {
			throw new Error("spawn npm ENOENT");
		}
		const dataCbs: ((c: string) => void)[] = [];
		const errCbs: ((c: string) => void)[] = [];
		let closeCb: ((code: number | null) => void) | null = null;
		let errorCb: ((e: Error) => void) | null = null;
		const proc: InstallProcess = {
			stdout: { on: (_e, cb) => dataCbs.push(cb as (c: string) => void) },
			stderr: { on: (_e, cb) => errCbs.push(cb as (c: string) => void) },
			on: (e, cb) => {
				if (e === "close") closeCb = cb as (code: number | null) => void;
				if (e === "error") errorCb = cb as (err: Error) => void;
			},
		};
		queueMicrotask(() => {
			for (const s of script.stdout ?? []) dataCbs.forEach((cb) => cb(s));
			for (const s of script.stderr ?? []) errCbs.forEach((cb) => cb(s));
			if (script.error) errorCb?.(script.error);
			else closeCb?.(script.close ?? 0);
		});
		return proc;
	};
}

describe("agent-installer pure helpers", () => {
	it("buildInstallArgs targets a global @latest install", () => {
		expect(buildInstallArgs("@scope/pkg")).toEqual({
			command: "npm",
			args: ["install", "-g", "@scope/pkg@latest"],
		});
	});

	it("summarizeInstallFailure maps the known failure shapes to plain guidance", () => {
		expect(summarizeInstallFailure(127, "npm: command not found")).toMatch(
			/Couldn't find npm/i,
		);
		expect(
			summarizeInstallFailure(1, "npm ERR! Error: EACCES permission denied"),
		).toMatch(/permission/i);
		expect(summarizeInstallFailure(1, "request to registry ETIMEDOUT")).toMatch(
			/network/i,
		);
		expect(summarizeInstallFailure(1, "some other failure")).toMatch(
			/didn't finish/i,
		);
	});
});

describe("installAgent (injected spawn)", () => {
	it("resolves ok on a clean exit and streams output", async () => {
		const chunks: string[] = [];
		const result = await installAgent("@scope/pkg", {
			env: {},
			onOutput: (c) => chunks.push(c),
			spawnFn: fakeSpawn({ stdout: ["added 1 package\n"], close: 0 }),
		});
		expect(result).toEqual({ ok: true, exitCode: 0 });
		expect(chunks.join("")).toContain("added 1 package");
	});

	it("resolves not-ok with permission guidance on an EACCES exit", async () => {
		const result = await installAgent("@scope/pkg", {
			env: {},
			spawnFn: fakeSpawn({
				stderr: ["npm ERR! Error: EACCES permission denied"],
				close: 1,
			}),
		});
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/permission/i);
	});

	it("resolves not-ok (no throw) when the spawn throws", async () => {
		const result = await installAgent("@scope/pkg", {
			env: {},
			spawnFn: fakeSpawn({ throwOnSpawn: true }),
		});
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBeNull();
		expect(result.message).toMatch(/npm|Node/i);
	});

	it("resolves not-ok on an error event", async () => {
		const result = await installAgent("@scope/pkg", {
			env: {},
			spawnFn: fakeSpawn({ error: new Error("spawn npm ENOENT") }),
		});
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBeNull();
		expect(result.message).toMatch(/npm|Node/i);
	});
});

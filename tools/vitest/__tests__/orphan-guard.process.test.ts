import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * I309, at the real process boundary: a forked child preloaded with the
 * guard must exit when its parent is SIGKILLed. Without the guard it keeps
 * running (the orphan that grew to 4.6 GB and took the machine down).
 */
const GUARD = path.resolve(__dirname, "../orphan-guard.cjs");

// Like a real vitest worker, the child's process.exit throws and an
// uncaughtException handler swallows the error, so a guard that called
// process.exit instead of SIGKILL would leave it running.
const CHILD_SRC = `
process.exit = (code) => { throw new Error("process.exit unexpectedly called with " + code); };
process.on("uncaughtException", () => {});
setInterval(() => {}, 1000);
`;

// The parent forks a guarded child that idles forever, prints the child's
// pid, then idles itself until the test kills it.
const PARENT_SRC = `
const { fork } = require("node:child_process");
const child = fork("-e", [${JSON.stringify(CHILD_SRC)}], {
	execArgv: ["--require", ${JSON.stringify(GUARD)}],
	stdio: ["ignore", "ignore", "ignore", "ipc"],
});
child.on("spawn", () => process.stdout.write(child.pid + "\\n"));
setInterval(() => {}, 1000);
`;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const started: number[] = [];

afterEach(() => {
	// Exact pids only: never pattern-kill.
	for (const pid of started.splice(0)) {
		if (alive(pid)) process.kill(pid, "SIGKILL");
	}
});

describe("orphan guard at the process boundary (I309)", () => {
	it("kills a forked worker once its parent is SIGKILLed", async () => {
		const parent = spawn(process.execPath, ["-e", PARENT_SRC], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		started.push(parent.pid!);
		const childPid = await new Promise<number>((resolve, reject) => {
			let out = "";
			parent.stdout!.on("data", (d: Buffer) => {
				out += d.toString();
				const n = Number.parseInt(out, 10);
				if (out.includes("\n") && n > 0) resolve(n);
			});
			parent.on("exit", () => reject(new Error("parent exited early")));
		});
		started.push(childPid);
		expect(alive(childPid)).toBe(true);

		process.kill(parent.pid!, "SIGKILL");

		const deadline = Date.now() + 5000;
		while (alive(childPid) && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}
		expect(alive(childPid)).toBe(false);
	}, 15000);

	// Thread pools need no guard (threads die with their process), so this
	// wiring check applies only when this test runs in a process worker.
	it.skipIf(typeof process.send !== "function")(
		"is preloaded, with the heap cap, into the worker running this test",
		() => {
			// This test runs inside a vitest fork worker, so its own execArgv is
			// the real wiring from vitest.config.ts, not a copy of it.
			const argv = process.execArgv;
			// vmForks prepends its own --require, so check every preload.
			const preloads = argv.filter((_, i) => argv[i - 1] === "--require");
			expect(preloads).toContain(GUARD);
			expect(argv).toContain("--max-old-space-size=1536");
		},
	);
});

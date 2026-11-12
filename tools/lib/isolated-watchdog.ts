/**
 * Detached watchdog for an isolated capture run. Usage:
 *   tsx tools/lib/isolated-watchdog.ts <state-file>
 *
 * The recorder holds our stdin open; EOF means it died. On EOF or a deadline
 * (per take, or the whole run) we tear down the current take. We exit when the
 * run-final `done` marker appears, after our own teardown, or after the cap
 * teardown completes. The run id is never in our argv or env, so the marker
 * scan can't match us.
 *
 * Spec: [[Agent Console Demo Video Automation]] § Containment.
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
	assertClean,
	listMarkedProcesses,
	type MarkedRow,
	nodeTeardownOps,
	readState,
	removeRunFiles,
	runDonePath,
	finishTake,
	cleanKiroSessionRecords,
} from "./isolated-instance";

const stateFile = process.argv[2];
let recorderGone = false;
process.stdin.on("end", () => (recorderGone = true));
process.stdin.on("error", () => (recorderGone = true));
process.stdin.resume();

const self = { pid: process.pid, started: "" };
const ops = nodeTeardownOps(() => {});

async function main(): Promise<void> {
	// Our start time identifies our lock; retry the listing instead of locking with "".
	for (let i = 0; i < 5 && !self.started; i++) {
		const rows: MarkedRow[] = await listMarkedProcesses().catch((): MarkedRow[] => []);
		self.started = rows.find((r) => r.pid === process.pid)?.started ?? "";
		if (!self.started) await sleep(500);
	}
	for (;;) {
		const s = readState(stateFile);
		if (s && existsSync(runDonePath(s.runId))) {
			// The recorder's own teardown can fail; a take without its done
			// marker still has processes to stop.
			if (!(await finishTake(s, self, ops))) process.stderr.write(`isolated-watchdog: take ${s.take} of ${s.runId} couldn't be torn down\n`);
			// The recorder may have exited before cleaning these (a second Ctrl-C).
			cleanKiroSessionRecords(s.runRoot);
			// Whichever process finishes last removes the run's files.
			while (!recorderGone) await sleep(250);
			removeRunFiles(s.runId);
			return;
		}
		const now = Date.now();
		const takeExpired = s && now > s.takeStartedAt + s.perTakeMs;
		const runExpired = s && now > s.runDeadline;
		if (s && (recorderGone || takeExpired || runExpired)) {
			if (!(await finishTake(s, self, ops))) process.stderr.write(`isolated-watchdog: take ${s.take} of ${s.runId} couldn't be torn down\n`);
			// The recorder may have exited before cleaning these (a second Ctrl-C).
			cleanKiroSessionRecords(s.runRoot);
			if (recorderGone || runExpired) {
				await assertClean(s, listMarkedProcesses).catch(() => []);
				removeRunFiles(s.runId);
				return;
			}
		}
		if (!s && recorderGone) return;
		await sleep(500);
	}
}

void main().then(() => process.exit(0));

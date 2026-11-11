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
	takeDonePath,
	teardownTake,
} from "./isolated-instance";

const stateFile = process.argv[2];
let recorderGone = false;
process.stdin.on("end", () => (recorderGone = true));
process.stdin.on("error", () => (recorderGone = true));
process.stdin.resume();

const self = { pid: process.pid, started: "" };
const ops = nodeTeardownOps(() => {});

async function main(): Promise<void> {
	const rows: MarkedRow[] = await listMarkedProcesses().catch((): MarkedRow[] => []);
	self.started = rows.find((r) => r.pid === process.pid)?.started ?? "";
	for (;;) {
		const s = readState(stateFile);
		if (s && existsSync(runDonePath(s.runId))) {
			// Whichever process finishes last removes the run's files.
			while (!recorderGone) await sleep(250);
			removeRunFiles(s.runId);
			return;
		}
		const now = Date.now();
		const takeExpired = s && now > s.takeStartedAt + s.perTakeMs;
		const runExpired = s && now > s.runDeadline;
		if (s && (recorderGone || takeExpired || runExpired)) {
			if (!existsSync(takeDonePath(s.runId, s.take))) await teardownTake(s, self, ops);
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

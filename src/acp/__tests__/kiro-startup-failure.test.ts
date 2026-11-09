/**
 * D3: classifyKiroStartupFailure truth table. Detection reads the exit code
 * and stderr, never a version string. Stderr samples are clap's output,
 * measured 2026-11-02 (see [[Kiro CLI V3 Support]] § Known Issues).
 */

import { describe, it, expect } from "vitest";
import {
	classifyKiroStartupFailure,
	kiroEngineUnsupportedInfo,
} from "../kiro-startup-failure";

const UNKNOWN_FLAG =
	"error: unexpected argument '--agent-engine' found\n\n  tip: to pass '--agent-engine' as a value, use '-- --agent-engine'\n";
const BAD_VALUE =
	"error: invalid value 'v3' for '--agent-engine <ENGINE>'\n  [possible values: v2, v1]\n";
const NO_ACP = "error: unrecognized subcommand 'acp'\n";

describe("classifyKiroStartupFailure (D3)", () => {
	it("V3 launch, exit 2, clap doesn't know the flag: engine-flag-unknown (I302)", () => {
		// The client maps this to D3's error for V3 chosen by name, and to
		// the V2 relaunch for the Default engine.
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 2, stderr: UNKNOWN_FLAG }),
		).toBe("engine-flag-unknown");
	});

	it("V3 launch, other non-zero exit naming the flag: engine-unsupported (I302 H1)", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 1, stderr: UNKNOWN_FLAG }),
		).toBe("engine-unsupported");
		expect(
			classifyKiroStartupFailure({
				launchedEngine: "v3",
				exitCode: 1,
				stderr: "error: could not start the agent for --agent-engine=v3",
			}),
		).toBe("engine-unsupported");
	});

	it("V3 launch, exit 2, the CLI lists engines without v3: engine-v3-missing (I302)", () => {
		// kiro-cli 2.7.1, measured 2026-11-09.
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 2, stderr: BAD_VALUE }),
		).toBe("engine-v3-missing");
	});

	it("a bad value other than v3, or another exit code, stays engine-unsupported", () => {
		expect(
			classifyKiroStartupFailure({
				launchedEngine: "v3",
				exitCode: 2,
				stderr: "error: invalid value 'v9' for '--agent-engine <ENGINE>'\n",
			}),
		).toBe("engine-unsupported");
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 1, stderr: BAD_VALUE }),
		).toBe("engine-unsupported");
	});

	it("V2 launch is never D3 (I270: an old CLI rejecting the V2 pin relaunches instead)", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v2", exitCode: 2, stderr: UNKNOWN_FLAG }),
		).toBe("engine-flag-unknown");
		expect(
			classifyKiroStartupFailure({ launchedEngine: undefined, exitCode: 2, stderr: UNKNOWN_FLAG }),
		).toBeNull();
	});

	it("exit 0 or no exit code is not D3", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 0, stderr: UNKNOWN_FLAG }),
		).toBeNull();
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: null, stderr: UNKNOWN_FLAG }),
		).toBeNull();
	});

	it("stderr not naming --agent-engine is not D3 (a CLI too old for acp fails on V2 too)", () => {
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 2, stderr: NO_ACP }),
		).toBeNull();
		expect(
			classifyKiroStartupFailure({ launchedEngine: "v3", exitCode: 1, stderr: "" }),
		).toBeNull();
	});

	it("the error text names the agent, the D1 setting and its V2 option", () => {
		const info = kiroEngineUnsupportedInfo("Kiro (old CLI)");
		expect(info.title).toBe("Kiro CLI needs an update");
		expect(info.suggestion).toBe(
			"Update Kiro CLI (kiro-cli update), or set Kiro CLI engine to V2 (legacy) in the settings for Kiro (old CLI).",
		);
	});
});

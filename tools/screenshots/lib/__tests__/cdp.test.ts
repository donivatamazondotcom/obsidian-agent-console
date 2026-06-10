/**
 * Tests for the Obsidian CDP wrapper.
 *
 * The wrapper invokes `obsidian dev:cdp` and `obsidian dev:screenshot`
 * once per call (Decision: per-call spawn, not persistent session) and
 * parses the stdout JSON response.
 *
 * Behaviors locked in test:
 * - `evaluate` builds the right command line for `Runtime.evaluate`
 * - Returns `result.value` on success
 * - Throws with the embedded message when the response has
 *   `exceptionDetails`
 * - Throws when the response is plaintext (e.g., unknown CDP method)
 * - Stderr noise (`sandbox initialization failed`) is ignored
 * - `getElementBounds` uses `getBoundingClientRect()` and parses the
 *   stringified result
 * - `clickElement` synthesizes a click and returns
 * - `waitForElement` polls until selector exists or timeout fires
 * - `screenshot` polls for the output file's existence after the spawn
 *
 * Test contract: tools/screenshots/lib/__tests__/cdp.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock child_process.spawn before importing the wrapper. Each test
// installs its own behavior on the mock. We expose both the named export
// (used by `import { spawn }`) and a default export (required by the
// esModuleInterop interop layer added in tsconfig).
type SpawnFn = (command: string, args: readonly string[]) => FakeProc;
const spawnMock = vi.fn<SpawnFn>();
vi.mock("node:child_process", () => ({
	spawn: ((command, args) => spawnMock(command, args)) as SpawnFn,
	default: {
		spawn: ((command, args) => spawnMock(command, args)) as SpawnFn,
	},
}));

// Import after mock is registered so the wrapper picks up the mocked
// spawn.
import { Cdp } from "../cdp";

interface FakeProc {
	stdout: EventEmitter;
	stderr: EventEmitter;
	emitter: EventEmitter;
	on: (event: string, listener: (...args: unknown[]) => void) => FakeProc;
}

/**
 * Build a fake child-process object that emits the given stdout, stderr,
 * and exit code. The wrapper should resolve from the data + close events.
 */
function makeFakeProc(opts: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}): FakeProc {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const emitter = new EventEmitter();
	const fake: FakeProc = {
		stdout,
		stderr,
		emitter,
		on(event, listener) {
			emitter.on(event, listener);
			return fake;
		},
	};
	// Async emit so the consumer has time to attach listeners.
	queueMicrotask(() => {
		if (opts.stdout) stdout.emit("data", Buffer.from(opts.stdout));
		if (opts.stderr) stderr.emit("data", Buffer.from(opts.stderr));
		emitter.emit("close", opts.exitCode ?? 0);
	});
	return fake;
}

const SANDBOX_NOISE =
	"sandbox initialization failed: Operation not permitted\nFailed to initialize sandbox.";

beforeEach(() => {
	spawnMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Cdp.evaluate", () => {
	it("invokes obsidian dev:cdp with Runtime.evaluate and returns result.value", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "number", value: 42 },
				}),
			}),
		);
		const cdp = new Cdp();
		const result = await cdp.evaluate<number>("1 + 1");
		expect(result).toBe(42);

		// Inspect the constructed command line
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(cmd).toBe("obsidian");
		expect(args[0]).toBe("dev:cdp");
		expect(args).toContain("method=Runtime.evaluate");
		// params should be a JSON blob containing the expression
		const paramsArg = args.find((a) => a.startsWith("params="));
		expect(paramsArg).toBeDefined();
		const params = JSON.parse(paramsArg!.slice("params=".length)) as {
			expression: string;
			returnByValue: boolean;
		};
		expect(params.expression).toBe("1 + 1");
		expect(params.returnByValue).toBe(true);
	});

	it("ignores sandbox-init stderr noise on success", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "string", value: "ok" },
				}),
				stderr: SANDBOX_NOISE,
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.evaluate<string>("'ok'")).resolves.toBe("ok");
	});

	it("throws when the response has exceptionDetails", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					exceptionDetails: {
						exception: {
							className: "Error",
							description: "Error: oops",
						},
						text: "Uncaught",
					},
					result: { type: "object" },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.evaluate("throw new Error('oops')")).rejects.toThrow(
			/oops/,
		);
	});

	it("throws when stdout is plaintext (unknown CDP method)", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: "Error: 'Runtime.invalidMethod' wasn't found\n",
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.evaluate("anything")).rejects.toThrow(
			/Runtime\.invalidMethod/,
		);
	});

	it("throws when stdout is empty", async () => {
		spawnMock.mockReturnValueOnce(makeFakeProc({ stdout: "" }));
		const cdp = new Cdp();
		await expect(cdp.evaluate("anything")).rejects.toThrow(
			/empty|no output/i,
		);
	});
});

describe("Cdp.getElementBounds", () => {
	it("returns the rect parsed from getBoundingClientRect", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: {
						type: "string",
						value: JSON.stringify({
							x: 0,
							y: 40,
							width: 44,
							height: 1248,
							top: 40,
							right: 44,
							bottom: 1288,
							left: 0,
						}),
					},
				}),
			}),
		);
		const cdp = new Cdp();
		const rect = await cdp.getElementBounds(".workspace-ribbon");
		expect(rect).toEqual({ x: 0, y: 40, width: 44, height: 1248 });
	});

	it("throws when the selector matches no element", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "undefined" },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.getElementBounds(".missing")).rejects.toThrow(
			/\.missing/,
		);
	});
});

describe("Cdp.clickElement", () => {
	it("synthesizes a click on the matched element", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "boolean", value: true },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.clickElement(".my-button")).resolves.toBeUndefined();
		const [, args] = spawnMock.mock.calls[0] as [string, string[]];
		const paramsArg = args.find((a) => a.startsWith("params="))!;
		const params = JSON.parse(paramsArg.slice("params=".length)) as {
			expression: string;
		};
		expect(params.expression).toContain(".my-button");
		expect(params.expression).toContain("click()");
	});

	it("throws when the selector matches no element", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "boolean", value: false },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.clickElement(".missing")).rejects.toThrow(/\.missing/);
	});
});

describe("Cdp.waitForElement", () => {
	it("resolves when the element exists on the first poll", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "boolean", value: true },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(
			cdp.waitForElement(".ready", 1000),
		).resolves.toBeUndefined();
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("rejects after the timeout when the element never appears", async () => {
		// Always return false; wait poller should keep trying.
		spawnMock.mockImplementation(() =>
			makeFakeProc({
				stdout: JSON.stringify({
					result: { type: "boolean", value: false },
				}),
			}),
		);
		const cdp = new Cdp();
		await expect(cdp.waitForElement(".never", 50)).rejects.toThrow(
			/timeout|\.never/i,
		);
	});
});

describe("Cdp.screenshot", () => {
	it("invokes obsidian dev:screenshot path=... and waits for the file", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "cdp-screenshot-test-"));
		const target = path.join(root, "shot.png");

		spawnMock.mockImplementationOnce(() => {
			// Simulate Obsidian writing the file shortly after the spawn returns.
			setTimeout(() => {
				writeFileSync(target, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
			}, 5);
			return makeFakeProc({ stdout: "", exitCode: 0 });
		});

		const cdp = new Cdp();
		await cdp.screenshot(target);
		expect(existsSync(target)).toBe(true);

		const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(cmd).toBe("obsidian");
		expect(args[0]).toBe("dev:screenshot");
		expect(args).toContain(`path=${target}`);

		unlinkSync(target);
	});

	it("rejects when the file never appears within the timeout", async () => {
		const target = path.join(tmpdir(), `cdp-never-${Date.now()}.png`);
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "", exitCode: 0 }),
		);
		const cdp = new Cdp({ screenshotTimeout: 50 });
		await expect(cdp.screenshot(target)).rejects.toThrow(/timeout|never/i);
	});
});

describe("Cdp.setMobileEmulation", () => {
	it("invokes obsidian dev:mobile on", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "", exitCode: 0 }),
		);
		const cdp = new Cdp();
		await cdp.setMobileEmulation(true);
		const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(cmd).toBe("obsidian");
		expect(args).toEqual(["dev:mobile", "on"]);
	});

	it("invokes obsidian dev:mobile off", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "", exitCode: 0 }),
		);
		const cdp = new Cdp();
		await cdp.setMobileEmulation(false);
		const [, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(args).toEqual(["dev:mobile", "off"]);
	});
});

describe("Cdp.setViewport (I11 — DPR fidelity)", () => {
	it("emits Emulation.setDeviceMetricsOverride with the given deviceScaleFactor", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "{}", exitCode: 0 }),
		);
		const cdp = new Cdp();
		await cdp.setViewport(1400, 760, 2);
		const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(cmd).toBe("obsidian");
		expect(args[0]).toBe("dev:cdp");
		expect(args).toContain("method=Emulation.setDeviceMetricsOverride");
		const paramsArg = args.find((a) => a.startsWith("params="))!;
		const params = JSON.parse(paramsArg.slice("params=".length)) as {
			width: number;
			height: number;
			deviceScaleFactor: number;
			mobile: boolean;
		};
		// Forcing deviceScaleFactor:1 on a retina (dpr=2) display halved the
		// captured resolution and dropped fine detail (I11); run.ts now passes
		// the detected real DPR through.
		expect(params).toEqual({
			width: 1400,
			height: 760,
			deviceScaleFactor: 2,
			mobile: false,
		});
	});

	it("defaults deviceScaleFactor to 1 when omitted (back-compat)", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "{}", exitCode: 0 }),
		);
		const cdp = new Cdp();
		await cdp.setViewport(800, 600);
		const [, args] = spawnMock.mock.calls[0] as [string, string[]];
		const params = JSON.parse(
			args.find((a) => a.startsWith("params="))!.slice("params=".length),
		) as { deviceScaleFactor: number };
		expect(params.deviceScaleFactor).toBe(1);
	});
});

describe("Cdp.clearViewport (I11)", () => {
	it("emits Emulation.clearDeviceMetricsOverride", async () => {
		spawnMock.mockReturnValueOnce(
			makeFakeProc({ stdout: "{}", exitCode: 0 }),
		);
		const cdp = new Cdp();
		await cdp.clearViewport();
		const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(cmd).toBe("obsidian");
		expect(args[0]).toBe("dev:cdp");
		expect(args).toContain("method=Emulation.clearDeviceMetricsOverride");
	});
});

describe("Cdp.setWindowAlwaysOnTop (I13 — float the fixtures window for screen capture)", () => {
	function proc() {
		return makeFakeProc({
			stdout: JSON.stringify({ result: { type: "boolean", value: true } }),
		});
	}

	it("floats at the 'floating' level and raises when enabled", async () => {
		spawnMock.mockImplementationOnce(() => proc());
		const cdp = new Cdp();
		await cdp.setWindowAlwaysOnTop(true);
		const params = (spawnMock.mock.calls[0][1] as string[]).find((a) =>
			a.startsWith("params="),
		)!;
		expect(params).toContain("setAlwaysOnTop(true");
		expect(params).toContain("floating");
		expect(params).toContain("moveTop");
	});

	it("clears alwaysOnTop when disabled", async () => {
		spawnMock.mockImplementationOnce(() => proc());
		const cdp = new Cdp();
		await cdp.setWindowAlwaysOnTop(false);
		const params = (spawnMock.mock.calls[0][1] as string[]).find((a) =>
			a.startsWith("params="),
		)!;
		expect(params).toContain("setAlwaysOnTop(false)");
		expect(params).not.toContain("floating");
	});
});


describe("Cdp.hoverElement (I15 — JS-dispatch hover, reliable when not OS-frontmost)", () => {
	function boolProc(value: boolean) {
		return makeFakeProc({
			stdout: JSON.stringify({ result: { type: "boolean", value } }),
		});
	}

	it("dispatches hover via Runtime.evaluate (mouseenter/over/move), not CDP Input", async () => {
		spawnMock.mockImplementationOnce(() => boolProc(true));
		const cdp = new Cdp();
		await cdp.hoverElement(".some-button");
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const args = spawnMock.mock.calls[0][1] as string[];
		expect(args).toContain("method=Runtime.evaluate");
		// must NOT use CDP Input.dispatchMouseEvent (dropped when not frontmost)
		expect(args.some((a) => a.includes("Input.dispatchMouseEvent"))).toBe(false);
		const params = args.find((a) => a.startsWith("params="))!;
		expect(params).toContain("mouseenter");
		expect(params).toContain("mouseover");
	});

	it("throws when the element is missing", async () => {
		spawnMock.mockImplementationOnce(() => boolProc(false));
		const cdp = new Cdp();
		await expect(cdp.hoverElement(".missing")).rejects.toThrow(
			/no element matches/i,
		);
	});
});


describe("Cdp.openNativeSelect (switch-default-agent — showPicker via userGesture)", () => {
	function strProc(value: string) {
		return makeFakeProc({
			stdout: JSON.stringify({ result: { type: "string", value } }),
		});
	}

	it("opens via showPicker() with userGesture transient activation", async () => {
		spawnMock.mockImplementationOnce(() => strProc("ok"));
		const cdp = new Cdp();
		await cdp.openNativeSelect(".vertical-tab-content select");
		const args = spawnMock.mock.calls[0][1] as string[];
		expect(args).toContain("method=Runtime.evaluate");
		const params = args.find((a) => a.startsWith("params="))!;
		const parsed = JSON.parse(params.slice("params=".length)) as {
			expression: string;
			userGesture?: boolean;
		};
		// userGesture is required — showPicker() throws NotAllowedError without it.
		expect(parsed.userGesture).toBe(true);
		expect(parsed.expression).toContain("showPicker");
		// Must NOT use CDP Input (silently dropped when not OS-frontmost — I13/I15).
		expect(args.some((a) => a.includes("Input.dispatchMouseEvent"))).toBe(false);
	});

	it("throws when the element is missing or lacks showPicker", async () => {
		spawnMock.mockImplementationOnce(() => strProc("no-element"));
		const cdp = new Cdp();
		await expect(cdp.openNativeSelect(".missing")).rejects.toThrow(
			/openNativeSelect/,
		);
	});
});

describe("Cdp.focusWindow (fire-and-forget; focus disrupts the IPC response)", () => {
	it("invokes Runtime.evaluate focus() and tolerates empty stdout", async () => {
		// A window focus() shifts OS focus and the dev:cdp response frequently
		// comes back empty; focusWindow must NOT throw on that (it routes through
		// runRaw, not the parsing evaluate, which would throw on empty output).
		spawnMock.mockImplementationOnce(() => makeFakeProc({ stdout: "" }));
		const cdp = new Cdp();
		await expect(cdp.focusWindow()).resolves.toBeUndefined();
		const args = spawnMock.mock.calls[0][1] as string[];
		expect(args).toContain("method=Runtime.evaluate");
		const params = args.find((a) => a.startsWith("params="))!;
		expect(params).toContain("focus()");
	});
});

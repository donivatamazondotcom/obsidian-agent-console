/**
 * Obsidian CDP wrapper.
 *
 * Per-call spawn — each method invokes `obsidian dev:cdp` or
 * `obsidian dev:screenshot` once and parses the stdout JSON. Cold-start
 * cost is acceptable for ~20 entries × ~5 commands per docs:screenshots
 * run; persistent CDP sessions were rejected for complexity (Decision in
 * spec § Phase C planning).
 *
 * Stderr noise: `obsidian` prints "sandbox initialization failed:
 * Operation not permitted" repeatedly on every invocation when run from
 * inside Obsidian's sandbox (Agent Console plugin's kiro-cli session).
 * This wrapper IGNORES that pattern entirely — the CLI's actual signal
 * is on stdout, and exit codes are unreliable. Real errors surface as
 * either:
 * - stdout JSON containing `exceptionDetails` (CDP threw an exception)
 * - stdout plaintext starting with `Error:` (unknown CDP method, etc.)
 * - empty stdout (something went wrong before producing output)
 *
 * `dev:screenshot` is fire-and-forget — exit code is always 0 even on
 * failure. The wrapper polls for output-file existence with a timeout
 * and treats absence as failure.
 *
 * Spec: [[Agent Console Screenshot Automation]] § Phase C.
 * Test contract: tools/screenshots/lib/__tests__/cdp.test.ts.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface CdpOptions {
	/**
	 * Path to the obsidian CLI binary. Defaults to "obsidian" (PATH
	 * lookup). Override for tests or non-default installs.
	 */
	binary?: string;
	/**
	 * Obsidian vault name to target. When set, prepends `vault=<name>`
	 * to every CLI invocation, ensuring commands hit the correct window
	 * even when multiple vaults are open. Required for screenshot
	 * automation (targets the fixtures vault, not the daily-driver).
	 */
	vault?: string;
	/** Timeout in ms for waitForElement polls. Default 5000. */
	waitTimeout?: number;
	/** Timeout in ms for screenshot file appearance. Default 5000. */
	screenshotTimeout?: number;
	/** Poll interval in ms for both wait operations. Default 50. */
	pollInterval?: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface CdpResponse {
	result?: {
		type: string;
		value?: unknown;
		description?: string;
	};
	exceptionDetails?: {
		exception?: { description?: string; className?: string };
		text?: string;
	};
}

interface ChildProcessLike {
	stdout: { on: (event: "data", listener: (chunk: Buffer) => void) => void };
	stderr: { on: (event: "data", listener: (chunk: Buffer) => void) => void };
	on(
		event: "close",
		listener: (code: number | null) => void,
	): ChildProcessLike;
	on(event: "error", listener: (err: Error) => void): ChildProcessLike;
}

export class Cdp {
	private readonly binary: string;
	private readonly vault: string | undefined;
	private readonly waitTimeout: number;
	private readonly screenshotTimeout: number;
	private readonly pollInterval: number;

	constructor(opts: CdpOptions = {}) {
		this.binary = opts.binary ?? "obsidian";
		this.vault = opts.vault;
		this.waitTimeout = opts.waitTimeout ?? 5000;
		this.screenshotTimeout = opts.screenshotTimeout ?? 5000;
		this.pollInterval = opts.pollInterval ?? 50;
	}

	/**
	 * Run a JavaScript expression in Obsidian's renderer and return the
	 * value. Throws on uncaught exceptions or unparseable output.
	 */
	async evaluate<T = unknown>(expression: string): Promise<T> {
		const params = JSON.stringify({ expression, returnByValue: true });
		const stdout = await this.runRaw([
			"dev:cdp",
			"method=Runtime.evaluate",
			`params=${params}`,
		]);
		return parseEvaluateResponse<T>(stdout);
	}

	/**
	 * Get `getBoundingClientRect()` for the first element matching the
	 * selector. Throws if no element matches.
	 */
	async getElementBounds(selector: string): Promise<Rect> {
		// We stringify the rect inside the page so we don't have to deal
		// with DOMRect serialization quirks across Chromium versions.
		const expr = `(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return undefined;
			const r = el.getBoundingClientRect();
			return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left });
		})()`;
		const stringified = await this.evaluate<string | undefined>(expr);
		if (typeof stringified !== "string") {
			throw new Error(
				`getElementBounds: no element matches selector ${selector}`,
			);
		}
		const parsed = JSON.parse(stringified) as Rect;
		return {
			x: parsed.x,
			y: parsed.y,
			width: parsed.width,
			height: parsed.height,
		};
	}

	/**
	 * Synthesize a `.click()` on the first element matching the selector.
	 * Throws if no element matches.
	 */
	async clickElement(selector: string): Promise<void> {
		const expr = `(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return false;
			el.click();
			return true;
		})()`;
		const ok = await this.evaluate<boolean>(expr);
		if (!ok) {
			throw new Error(
				`clickElement: no element matches selector ${selector}`,
			);
		}
	}

	/**
	 * Open a menu/popover by invoking the target element's React onClick
	 * handler with a synthetic event carrying the element-center coordinates.
	 *
	 * Why not el.click() or CDP Input events: Obsidian's themed dropdowns call
	 * `Menu.showAtMouseEvent(e.nativeEvent)`, positioning the popup from the
	 * event's clientX/clientY. A bare el.click() fires at (0,0); CDP
	 * Input.dispatchMouseEvent is silently ignored unless the window is the
	 * OS-frontmost app (it never reaches the renderer in our headless driver).
	 * Invoking the React handler directly with real coords reliably opens the
	 * menu. The menu then renders as a native popup window — invisible to
	 * dev:screenshot — so pair clickWithCoords with `captureMode: "screen"`.
	 *
	 * Brings Obsidian to the OS foreground first (macOS `activate`) so the
	 * popup renders on top of the screen for the subsequent screencapture.
	 */
	async clickWithCoords(selector: string): Promise<void> {
		try {
			execSync('osascript -e \'tell application "Obsidian" to activate\'', {
				timeout: 3000,
			});
		} catch {
			// Non-macOS or osascript unavailable — best-effort in-app focus.
			await this.evaluate(
				`(() => { try { require("@electron/remote").getCurrentWindow().focus(); } catch (e) {} })()`,
			);
		}
		await sleep(300); // Let the activation propagate before opening the menu.
		const expr = `(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return false;
			const r = el.getBoundingClientRect();
			const cx = r.x + r.width / 2;
			const cy = r.y + r.height / 2;
			const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
			const props = key ? el[key] : null;
			if (props && typeof props.onClick === "function") {
				const native = new MouseEvent("click", { bubbles: true, clientX: cx, clientY: cy, view: window });
				props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: native, currentTarget: el, target: el, clientX: cx, clientY: cy, button: 0 });
				return true;
			}
			el.click();
			return true;
		})()`;
		const ok = await this.evaluate<boolean>(expr);
		if (!ok) {
			throw new Error(
				`clickWithCoords: no element matches selector ${selector}`,
			);
		}
	}

	/**
	 * Get the Electron window's bounds in global logical-point coordinates,
	 * plus the backing scale factor of the display it sits on. Used to drive a
	 * screen-capture region and to scale crops for `captureMode: "screen"`.
	 */
	async getWindowBounds(): Promise<{
		x: number;
		y: number;
		width: number;
		height: number;
		scaleFactor: number;
	}> {
		const expr = `(() => {
			try {
				const remote = require("@electron/remote");
				const win = remote.getCurrentWindow();
				const b = win.getBounds();
				const display = remote.screen.getDisplayMatching(b);
				return JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, scaleFactor: (display && display.scaleFactor) || 1 });
			} catch (e) { return JSON.stringify({ __error: String(e) }); }
		})()`;
		const stringified = await this.evaluate<string>(expr);
		const parsed = JSON.parse(stringified) as {
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			scaleFactor?: number;
			__error?: string;
		};
		if (parsed.__error || parsed.x === undefined) {
			throw new Error(
				`getWindowBounds failed: ${parsed.__error ?? "no bounds returned"}`,
			);
		}
		return {
			x: parsed.x,
			y: parsed.y as number,
			width: parsed.width as number,
			height: parsed.height as number,
			scaleFactor: parsed.scaleFactor ?? 1,
		};
	}

	/**
	 * Set the Electron window's bounds (global logical-point coords). Used by
	 * screen-capture mode to pin the window to a fixed, reproducible size and
	 * position before driving the UI, so the screencapture region and the
	 * static crop are stable across runs.
	 */
	async setWindowBounds(bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): Promise<void> {
		await this.evaluate(
			`(() => { try { require("@electron/remote").getCurrentWindow().setBounds(${JSON.stringify(bounds)}); return true; } catch (e) { return false; } })()`,
		);
	}

	/**
	 * Get the primary display's work area (screen minus menu bar / dock) in
	 * logical points, plus its backing scale factor. Used to bottom-align the
	 * capture window so Obsidian flips popover menus upward (keeping them
	 * inside the captured window region rather than spilling off-screen).
	 */
	async getWorkArea(): Promise<{
		x: number;
		y: number;
		width: number;
		height: number;
		scaleFactor: number;
	}> {
		const expr = `(() => {
			try {
				const d = require("@electron/remote").screen.getPrimaryDisplay();
				return JSON.stringify({ x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height, scaleFactor: d.scaleFactor });
			} catch (e) { return JSON.stringify({ __error: String(e) }); }
		})()`;
		const stringified = await this.evaluate<string>(expr);
		const parsed = JSON.parse(stringified) as {
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			scaleFactor?: number;
			__error?: string;
		};
		if (parsed.__error || parsed.x === undefined) {
			throw new Error(
				`getWorkArea failed: ${parsed.__error ?? "no work area returned"}`,
			);
		}
		return {
			x: parsed.x,
			y: parsed.y as number,
			width: parsed.width as number,
			height: parsed.height as number,
			scaleFactor: parsed.scaleFactor ?? 1,
		};
	}

	/**
	 * Capture a screen rectangle (global logical-point coords) to a PNG via
	 * macOS `screencapture -R`. Unlike `screenshot()` (dev:screenshot, which
	 * only sees the BrowserWindow renderer), this captures the composited
	 * screen — including native popup windows like Obsidian's `Menu`, which
	 * render outside the renderer. Output is at the display backing scale
	 * (physical px). Polls for file appearance. macOS-only.
	 */
	async screenCaptureRegion(
		outputPath: string,
		region: { x: number; y: number; width: number; height: number },
	): Promise<void> {
		const rectArg = `-R${region.x},${region.y},${region.width},${region.height}`;
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("screencapture", ["-x", rectArg, outputPath]);
			proc.on("close", () => resolve());
			proc.on("error", (err) => reject(err));
		});
		const deadline = Date.now() + this.screenshotTimeout;
		while (!existsSync(outputPath)) {
			if (Date.now() >= deadline) {
				throw new Error(
					`screenCaptureRegion: file ${outputPath} never appeared within ${this.screenshotTimeout}ms (timeout)`,
				);
			}
			await sleep(this.pollInterval);
		}
	}

	/**
	 * Poll `document.querySelector(selector)` until it returns truthy or
	 * the timeout elapses. Resolves on success, rejects on timeout.
	 */
	async waitForElement(selector: string, timeoutMs?: number): Promise<void> {
		const timeout = timeoutMs ?? this.waitTimeout;
		const deadline = Date.now() + timeout;
		const expr = `!!document.querySelector(${JSON.stringify(selector)})`;

		// First check before sleeping — the element is often already there.
		while (true) {
			const exists = await this.evaluate<boolean>(expr);
			if (exists) return;
			if (Date.now() >= deadline) {
				throw new Error(
					`waitForElement: timeout waiting for ${selector} after ${timeout}ms`,
				);
			}
			await sleep(this.pollInterval);
		}
	}

	/**
	 * Capture a screenshot of the active Obsidian window to the given
	 * path. Polls for file existence after spawn — `dev:screenshot` is
	 * fire-and-forget and exit code is unreliable. Throws on timeout.
	 */
	async screenshot(outputPath: string): Promise<void> {
		await this.runRaw(["dev:screenshot", `path=${outputPath}`]);
		// Poll for file appearance. Obsidian writes async after the CLI
		// returns; we can't trust exit code or stdout here.
		const deadline = Date.now() + this.screenshotTimeout;
		while (!existsSync(outputPath)) {
			if (Date.now() >= deadline) {
				throw new Error(
					`screenshot: file ${outputPath} never appeared within ${this.screenshotTimeout}ms (timeout)`,
				);
			}
			await sleep(this.pollInterval);
		}
	}

	/** Toggle `dev:mobile on|off`. */
	async setMobileEmulation(enabled: boolean): Promise<void> {
		await this.runRaw(["dev:mobile", enabled ? "on" : "off"]);
	}

	/**
	 * Override the renderer viewport via Emulation.setDeviceMetricsOverride.
	 * `deviceScaleFactor` MUST match the real display DPR for capture fidelity:
	 * forcing 1 on a retina (dpr=2) display halves the captured resolution and
	 * drops fine detail such as tooltip text (I11). Defaults to 1 for
	 * back-compat; run.ts passes the detected real DPR.
	 */
	async setViewport(
		width: number,
		height: number,
		deviceScaleFactor = 1,
	): Promise<void> {
		const params = JSON.stringify({ width, height, deviceScaleFactor, mobile: false });
		await this.runRaw(["dev:cdp", "method=Emulation.setDeviceMetricsOverride", `params=${params}`]);
	}

	/**
	 * Clear any active device-metrics override. The override persists in the
	 * running Obsidian's CDP session across separate `npm run docs:screenshots`
	 * invocations and survives setup.sh's plugin reload, so a prior run's
	 * override (e.g. deviceScaleFactor:1) otherwise pins window.devicePixelRatio
	 * to a stale value when the next run detects DPR (I11). Call before DPR
	 * detection.
	 */
	async clearViewport(): Promise<void> {
		await this.runRaw(["dev:cdp", "method=Emulation.clearDeviceMetricsOverride", "params={}"]);
	}

	/**
	 * Move the mouse to the center of the element matching the selector,
	 * triggering native hover/tooltip behavior. Uses CDP
	 * `Input.dispatchMouseEvent` which works where synthetic MouseEvent
	 * dispatches don't (Obsidian tooltips require pointer position tracking).
	 */
	async hoverElement(selector: string): Promise<void> {
		const bounds = await this.getElementBounds(selector);
		const x = Math.round(bounds.x + bounds.width / 2);
		const y = Math.round(bounds.y + bounds.height / 2);
		const params = JSON.stringify({ type: "mouseMoved", x, y });
		await this.runRaw(["dev:cdp", "method=Input.dispatchMouseEvent", `params=${params}`]);
	}

	/**
	 * Spawn `obsidian` with the given args and resolve with the captured
	 * stdout. Stderr is read but discarded (it's all sandbox-init noise
	 * in our environment). Rejects only on spawn-level errors (binary
	 * missing, EACCES). Exit code is NOT checked because `obsidian` exits
	 * 0 on most CDP errors.
	 */
	private runRaw(args: string[]): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const fullArgs = this.vault ? [`vault=${this.vault}`, ...args] : args;
			const proc = spawn(
				this.binary,
				fullArgs,
			) as unknown as ChildProcessLike;
			const stdoutChunks: Buffer[] = [];
			proc.stdout.on("data", (chunk) =>
				stdoutChunks.push(Buffer.from(chunk)),
			);
			// Read stderr to drain the pipe but don't keep the data — it's
			// all sandbox-init noise.
			proc.stderr.on("data", () => {
				/* drain */
			});
			proc.on("close", () => {
				resolve(Buffer.concat(stdoutChunks).toString("utf8"));
			});
			proc.on("error", (err) => reject(err));
		});
	}
}

function parseEvaluateResponse<T>(stdout: string): T {
	const trimmed = stdout.trim();
	if (trimmed === "") {
		throw new Error("CDP evaluate: empty output from obsidian");
	}
	// Plaintext error (e.g., unknown method) — `obsidian dev:cdp` writes
	// `Error: '...' wasn't found` to stdout, not a JSON object.
	if (!trimmed.startsWith("{")) {
		throw new Error(`CDP evaluate: ${trimmed}`);
	}
	let parsed: CdpResponse;
	try {
		parsed = JSON.parse(trimmed) as CdpResponse;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`CDP evaluate: failed to parse stdout as JSON: ${msg}`);
	}
	if (parsed.exceptionDetails) {
		const desc =
			parsed.exceptionDetails.exception?.description ??
			parsed.exceptionDetails.text ??
			"unknown error";
		throw new Error(`CDP evaluate threw: ${desc}`);
	}
	if (!parsed.result) {
		throw new Error("CDP evaluate: response missing result field");
	}
	return parsed.result.value as T;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

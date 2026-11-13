import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Cdp, IsolatedUnsupportedError, newestTitledPage, SETTINGS_WINDOW_HOOK, type CdpTransport } from "../cdp";

function transport(handler: (method: string, params: Record<string, unknown>) => unknown) {
	const send = vi.fn((m: string, p: Record<string, unknown>) => Promise.resolve(handler(m, p)));
	return { t: { send } as CdpTransport, send };
}

describe("Cdp over an isolated transport", () => {
	it("evaluates through Runtime.evaluate and returns the value", async () => {
		const { t, send } = transport(() => ({ result: { type: "number", value: 42 } }));
		const cdp = new Cdp({ transport: t });
		expect(await cdp.evaluate<number>("6*7")).toBe(42);
		expect(send).toHaveBeenCalledWith("Runtime.evaluate", { expression: "6*7", returnByValue: true, awaitPromise: false });
	});

	it("surfaces page exceptions as errors, like the CLI path", async () => {
		const { t } = transport(() => ({ exceptionDetails: { text: "ReferenceError: x" } }));
		await expect(new Cdp({ transport: t }).evaluate("x")).rejects.toThrow(/ReferenceError: x/);
	});

	it("turns a transport failure into an evaluate error, not a hang", async () => {
		const send = vi.fn(() => Promise.reject(new Error("Target closed")));
		await expect(new Cdp({ transport: { send } }).evaluate("1")).rejects.toThrow(/Target closed/);
	});

	it("writes Page.captureScreenshot data to the requested file", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "cdpi-"));
		try {
			const { t, send } = transport(() => ({ data: Buffer.from("png-bytes").toString("base64") }));
			const out = path.join(dir, "shot.png");
			await new Cdp({ transport: t }).screenshot(out);
			expect(send).toHaveBeenCalledWith("Page.captureScreenshot", { format: "png" });
			expect(readFileSync(out, "utf8")).toBe("png-bytes");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sends viewport emulation over CDP", async () => {
		const { t, send } = transport(() => ({}));
		const cdp = new Cdp({ transport: t });
		await cdp.setViewport(1400, 760, 2);
		await cdp.clearViewport();
		expect(send).toHaveBeenNthCalledWith(1, "Emulation.setDeviceMetricsOverride", { width: 1400, height: 760, deviceScaleFactor: 2, mobile: false });
		expect(send).toHaveBeenNthCalledWith(2, "Emulation.clearDeviceMetricsOverride", {});
	});

	it("never raises the window", async () => {
		const { t, send } = transport(() => ({ result: { type: "boolean", value: true } }));
		const cdp = new Cdp({ transport: t });
		await cdp.focusWindow();
		await cdp.setWindowAlwaysOnTop(true);
		expect(send).not.toHaveBeenCalled();
	});

	it("refuses capture paths that need the real screen", async () => {
		const { t } = transport(() => ({}));
		const cdp = new Cdp({ transport: t });
		await expect(cdp.screenCaptureRegion("/tmp/x.png", { x: 0, y: 0, width: 1, height: 1 })).rejects.toBeInstanceOf(IsolatedUnsupportedError);
		await expect(cdp.setMobileEmulation(true)).rejects.toBeInstanceOf(IsolatedUnsupportedError);
	});

	it("legacy mode is unchanged: no transport means not isolated", () => {
		expect(new Cdp({ vault: "studio" }).isolated).toBe(false);
		expect(new Cdp({ transport: transport(() => ({})).t }).isolated).toBe(true);
	});
});

// [[Agent Console Isolated Screenshot Capture]] PR 2b: the settings window on
// the isolated driver. It opens non-focusable, its page is a separate CDP
// target found by title prefix, and DOM work and the capture run on that page.
describe("Cdp over an isolated transport: the settings window", () => {
	const PREFIX = "Settings - studio - ";
	const OPTS = { width: 1200, height: 900, dpr: 2 };

	/** A main page plus a settings page reachable through `page(prefix)`. */
	function twoPages(settingsDpr = 2) {
		const main = vi.fn((m: string, p: Record<string, unknown>) => {
			if (m === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "ok" } });
			return Promise.resolve({ m, p });
		});
		const settings = vi.fn((m: string, p: Record<string, unknown>) => {
			if (m === "Runtime.evaluate") {
				const e = String(p.expression);
				if (e === "window.devicePixelRatio") return Promise.resolve({ result: { type: "number", value: settingsDpr } });
				return Promise.resolve({ result: { type: "string", value: `ran:${e}` } });
			}
			if (m === "Page.captureScreenshot") return Promise.resolve({ data: Buffer.from("settings-png").toString("base64") });
			return Promise.resolve({});
		});
		const page = vi.fn((prefix: string) => Promise.resolve(prefix === PREFIX ? ({ send: settings } as CdpTransport) : null));
		const cdp = new Cdp({ vault: "studio", transport: { send: main, page }, waitTimeout: 200, pollInterval: 10 });
		return { cdp, main, settings, page };
	}

	const mainExpr = (main: ReturnType<typeof vi.fn>): string =>
		String((main.mock.calls.find((c) => c[0] === "Runtime.evaluate")?.[1] as { expression: string }).expression);

	/**
	 * Runs the real page expression against a fake @electron/remote and app,
	 * so the tests see what the expression does to the windows, not where a
	 * string sits in it.
	 */
	function fakeElectron(o: { existing?: boolean; closing?: boolean; lateMs?: number; openThrows?: boolean; noWindow?: boolean; displays?: { scaleFactor: number; workArea: { x: number; y: number } }[] } = {}) {
		const events: string[] = [];
		const displays = o.displays ?? [{ scaleFactor: 2, workArea: { x: 0, y: 25 } }];
		let nextId = 2;
		const mkWin = (title: string) => ({
			id: nextId++, title, focusable: true, ignoreMouse: false, opacity: 1, size: null as number[] | null, pos: null as number[] | null,
			getTitle() { return this.title; },
			isDestroyed() { return false; },
			isVisible() { return false; },
			isFocusable() { return this.focusable; },
			setFocusable(v: boolean) { this.focusable = v; events.push(`focusable:${this.title}:${v}`); },
			setIgnoreMouseEvents(v: boolean) { this.ignoreMouse = v; },
			shown: "" as string,
			show() { this.shown = "show"; },
			showInactive() { this.shown = "inactive"; },
			focus() { events.push(`focus:${this.title}`); },
			setOpacity(v: number) { this.opacity = v; },
			on() {},
			setContentSize(w: number, h: number) { this.size = [w, h]; },
			getBounds() { return { x: 0, y: 0, width: 10, height: 10 }; },
			setPosition(x: number, y: number) { this.pos = [x, y]; },
		});
		const windows = [mkWin("Welcome - studio - Obsidian 1.15.0")];
		if (o.existing) windows.push(mkWin(`${PREFIX}Obsidian 1.15.0`));
		const listeners = new Set<(e: unknown, w: unknown) => void>();
		const fakeApp = {
			once: (ev: string, f: (e: unknown, w: unknown) => void) => { events.push(`once:${ev}`); listeners.add(f); },
			removeListener: (_ev: string, f: (e: unknown, w: unknown) => void) => listeners.delete(f),
		};
		// The real main-process hook, with the fake app in place of electron's.
		const realHook = createRequire(import.meta.url)(SETTINGS_WINDOW_HOOK) as { tame(w: unknown): void; armOnce(a: unknown): void; disarm(): void; setLog(p: string): void };
		const remote = {
			require: (p: string) => {
				events.push(`require:${p}`);
				return { tame: realHook.tame, setLog: realHook.setLog, disarm: realHook.disarm, armOnce: () => realHook.armOnce(fakeApp), watchFocus: () => {} };
			},
			BrowserWindow: { getAllWindows: () => windows },
			app: fakeApp,
			screen: { getDisplayMatching: () => displays[0], getAllDisplays: () => displays },
		};
		const app = {
			setting: {
				open: () => {
					events.push("open");
					if (o.openThrows) throw new Error("open failed");
					if (o.noWindow) return;
					const create = () => {
						const w = mkWin(`${PREFIX}Obsidian 1.15.0`);
						windows.push(w);
						for (const f of [...listeners]) {
							listeners.delete(f);
							f({}, w);
						}
						w.show();
						w.focus();
					};
					if (o.lateMs !== undefined) {
						// Obsidian creates the replacement a little after open() returns.
						setTimeout(create, o.lateMs);
						return;
					}
					if (o.closing || !windows.some((w) => w.title.startsWith(PREFIX))) {
						const w = mkWin(`${PREFIX}Obsidian 1.15.0`);
						windows.push(w);
						for (const f of [...listeners]) {
							listeners.delete(f);
							f({}, w);
						}
						// What Obsidian does with a new settings window.
						w.show();
						w.focus();
					}
				},
				openTabById: (id: string) => events.push(`tab:${id}`),
			},
		};
		const settingsWindow = () => windows.filter((w) => w.title.startsWith(PREFIX)).at(-1);
		const main = vi.fn(async (m: string, p: Record<string, unknown>) => {
			if (m !== "Runtime.evaluate") return {};
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			const v: unknown = await (new Function("require", "app", `return (${String(p.expression)});`) as (r: unknown, a: unknown) => unknown)(
				(id: string) => (id === "@electron/remote" ? remote : undefined),
				app,
			);
			return { result: { type: typeof v, value: v } };
		});
		const settings = vi.fn((m: string, p: Record<string, unknown>) =>
			Promise.resolve(m === "Runtime.evaluate" ? { result: { type: "string", value: `ran:${String(p.expression)}` } } : {}),
		);
		const page = vi.fn((prefix: string) => Promise.resolve(prefix === PREFIX ? ({ send: settings } as CdpTransport) : null));
		const cdp = new Cdp({ vault: "studio", transport: { send: main, page }, waitTimeout: 200, pollInterval: 10 });
		return { cdp, events, settingsWindow, settings, listeners };
	}

	it("makes a new settings window non-focusable and click-through as it is created, hook armed before the open", async () => {
		const f = fakeElectron();
		await f.cdp.openSettingsHidden("agent-console", OPTS);
		const w = f.settingsWindow();
		// Obsidian's show() and focus() of the new window never activate the app.
		expect(w?.shown).toBe("inactive");
		expect(f.events.filter((e) => e.startsWith("focus:"))).toEqual([]);
		expect(w?.focusable).toBe(false);
		expect(w?.ignoreMouse).toBe(true);
		expect(w?.opacity).toBe(0);
		// The hook runs in the main process, armed before the open.
		expect(f.events[0]).toBe(`require:${SETTINGS_WINDOW_HOOK}`);
		expect(f.events.indexOf("once:browser-window-created")).toBeLessThan(f.events.indexOf("open"));
		expect(f.events).toContain("tab:agent-console");
	});

	it("reuses an open settings window without leaving a creation hook armed", async () => {
		const f = fakeElectron({ existing: true });
		await f.cdp.openSettingsHidden("agent-console", OPTS);
		expect(f.listeners.size).toBe(0);
		expect(f.settingsWindow()?.focusable).toBe(false);
		expect(f.settingsWindow()?.ignoreMouse).toBe(true);
	});

	it("waits for a replacement created after open() returns, and tames and sizes it, not the closing one", async () => {
		const f = fakeElectron({ existing: true, lateMs: 60 });
		await f.cdp.openSettingsHidden("agent-console", { width: 1000, height: 800, dpr: 2 });
		const w = f.settingsWindow();
		expect(w?.shown).toBe("inactive");
		expect(f.events.filter((e) => e.startsWith("focus:"))).toEqual([]);
		expect(w?.size).toEqual([1000, 800]);
		expect(f.listeners.size).toBe(0);
	});

	it("leaves no creation listener armed when the open throws or no window appears", async () => {
		const a = fakeElectron({ openThrows: true });
		await expect(a.cdp.openSettingsHidden("agent-console", OPTS)).rejects.toThrow(/open failed/);
		expect(a.listeners.size).toBe(0);
		const b = fakeElectron({ noWindow: true });
		await expect(b.cdp.openSettingsHidden("agent-console", OPTS)).rejects.toThrow(/no settings window/);
		expect(b.listeners.size).toBe(0);
	});

	it("tames the new window when the open one was still closing", async () => {
		const f = fakeElectron({ existing: true, closing: true });
		await f.cdp.openSettingsHidden("agent-console", OPTS);
		const w = f.settingsWindow();
		expect(w?.shown).toBe("inactive");
		expect(f.events.filter((e) => e.startsWith("focus:"))).toEqual([]);
		expect(f.listeners.size).toBe(0);
	});

	it("sizes the settings window and moves it onto a display at the target scale factor", async () => {
		const f = fakeElectron({ displays: [{ scaleFactor: 1, workArea: { x: 0, y: 25 } }, { scaleFactor: 2, workArea: { x: 2000, y: 0 } }] });
		await f.cdp.openSettingsHidden("agent-console", { width: 1000, height: 800, dpr: 2 });
		expect(f.settingsWindow()?.size).toEqual([1000, 800]);
		expect(f.settingsWindow()?.pos).toEqual([2020, 20]);
	});

	it("fails with the page's reason when the settings window never appears", async () => {
		const { cdp, main } = twoPages();
		main.mockImplementation(() => Promise.resolve({ result: { type: "string", value: "no settings window" } }));
		await expect(cdp.openSettingsHidden("agent-console", OPTS)).rejects.toThrow(/openSettingsHidden: no settings window/);
	});

	it("always renders the settings page at the requested size and DPR, by emulation", async () => {
		for (const dpr of [1, 2]) {
			const { cdp, settings } = twoPages(dpr);
			await cdp.openSettingsHidden("agent-console", OPTS);
			expect(settings).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 2, mobile: false });
		}
	});

	it("runs evaluateInSettings on the settings page, never the main page", async () => {
		const { cdp, main, settings, page } = twoPages();
		expect(await cdp.evaluateInSettings<string>("document.title")).toBe("ran:document.title");
		expect(page).toHaveBeenCalledWith(PREFIX);
		expect(settings).toHaveBeenCalledWith("Runtime.evaluate", { expression: "document.title", returnByValue: true, awaitPromise: false });
		expect(main).not.toHaveBeenCalled();
	});

	it("retries a settings command only when its page has closed, never after another error", async () => {
		const { cdp, settings } = twoPages();
		settings.mockRejectedValueOnce(new Error("Target page, context or browser has been closed"));
		expect(await cdp.evaluateInSettings<string>("1")).toBe("ran:1");
		expect(settings).toHaveBeenCalledTimes(2);
		settings.mockClear();
		settings.mockRejectedValueOnce(new Error("Execution context was destroyed"));
		await expect(cdp.evaluateInSettings("click()")).rejects.toThrow(/Execution context was destroyed/);
		expect(settings).toHaveBeenCalledTimes(1);
	});

	it("moves the settings page's pointer off every element on the isolated driver, and does nothing on legacy", async () => {
		const { cdp, main, settings } = twoPages();
		await cdp.settingsPointerAway();
		expect(settings).toHaveBeenCalledWith("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
		expect(main).not.toHaveBeenCalled();
		const legacy = new Cdp({ vault: "studio" });
		const spy = vi.spyOn(legacy, "evaluate");
		await legacy.settingsPointerAway();
		expect(spy).not.toHaveBeenCalled();
	});

	it("waits for the settings page target to appear, then fails clearly if it never does", async () => {
		const { cdp, page } = twoPages();
		page.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
		expect(await cdp.evaluateInSettings<string>("1")).toBe("ran:1");
		page.mockResolvedValue(null);
		await expect(cdp.evaluateInSettings("1")).rejects.toThrow(/no settings page titled "Settings - studio - …"/);
	});

	it("captures the settings page with Page.captureScreenshot", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "cdpi-"));
		try {
			const { cdp, main, settings } = twoPages();
			const out = path.join(dir, "settings.png");
			await cdp.captureSettingsWindow(out);
			expect(settings).toHaveBeenCalledWith("Page.captureScreenshot", { format: "png" });
			expect(main).not.toHaveBeenCalled();
			expect(readFileSync(out, "utf8")).toBe("settings-png");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("legacy evaluateInSettings is the main-page evaluate (activeDocument follows the settings window)", async () => {
		const cdp = new Cdp({ vault: "studio" });
		const spy = vi.spyOn(cdp, "evaluate").mockResolvedValue(5);
		expect(await cdp.evaluateInSettings<number>("activeDocument.title.length")).toBe(5);
		expect(spy).toHaveBeenCalledWith("activeDocument.title.length", undefined);
	});
});

describe("newestTitledPage (settings page lookup)", () => {
	const pg = (title: string | Error, closed = false) => ({ title, closed });
	const find = (pages: ReturnType<typeof pg>[], exclude: unknown) =>
		newestTitledPage(pages, exclude, "Settings - studio - ", (p) => (p.title instanceof Error ? Promise.reject(p.title) : Promise.resolve(p.title)), (p) => p.closed);

	it("returns the newest live page with the title prefix, never the workspace page", async () => {
		const workspace = pg("Settings - studio - but the workspace");
		const older = pg("Settings - studio - Obsidian 1.15.0");
		const newer = pg("Settings - studio - Obsidian 1.15.0");
		expect(await find([older, workspace, newer, pg("Untitled")], workspace)).toBe(newer);
	});

	it("skips closed pages and pages whose title can't be read", async () => {
		const live = pg("Settings - studio - x");
		expect(await find([live, pg("Settings - studio - y", true), pg(new Error("Target closed"))], null)).toBe(live);
		expect(await find([pg("Other")], null)).toBeNull();
	});
});

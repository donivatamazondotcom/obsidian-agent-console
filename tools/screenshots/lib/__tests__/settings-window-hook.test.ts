import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { SETTINGS_WINDOW_HOOK } from "../cdp";

// The hook runs in the isolated Obsidian's main process (loaded with
// @electron/remote's require); here it runs against a fake BrowserWindow.
const hook = createRequire(import.meta.url)(SETTINGS_WINDOW_HOOK) as {
	tame(w: unknown): void;
	armOnce(app: FakeApp): void;
	disarm(): void;
	setLog(p: string): void;
};

interface FakeApp {
	once(ev: string, f: (e: unknown, w: unknown) => void): void;
	removeListener(ev: string, f: unknown): void;
}

function fakeApp() {
	const listeners = new Set<(e: unknown, w: unknown) => void>();
	const app: FakeApp = {
		once: (_ev, f) => listeners.add(f),
		removeListener: (_ev, f) => listeners.delete(f as (e: unknown, w: unknown) => void),
	};
	const create = (w: unknown) => {
		for (const f of [...listeners]) {
			listeners.delete(f);
			f({}, w);
		}
	};
	return { app, listeners, create };
}

function fakeWindow(id = 3) {
	const calls: string[] = [];
	const w = {
		id,
		focusable: true,
		ignoreMouse: false,
		opacity: 1,
		setOpacity(v: number) { this.opacity = v; },
		isDestroyed: () => false,
		isVisible: () => false,
		isFocusable() { return this.focusable; },
		setFocusable(v: boolean) { this.focusable = v; calls.push(`focusable:${v}`); },
		setIgnoreMouseEvents(v: boolean) { this.ignoreMouse = v; calls.push(`ignoreMouse:${v}`); },
		show: () => calls.push("show"),
		showInactive: () => calls.push("showInactive"),
		focus: () => calls.push("focus"),
	};
	return { w, calls };
}

describe("settings-window-hook (main process)", () => {
	it("tames a window: hidden, no focus, click-through, show() never activates the app", () => {
		const { w, calls } = fakeWindow();
		hook.tame(w);
		expect(w.opacity).toBe(0);
		expect(w.focusable).toBe(false);
		expect(w.ignoreMouse).toBe(true);
		w.show();
		w.focus();
		expect(calls).toEqual(["focusable:false", "ignoreMouse:true", "showInactive"]);
	});

	it("tames a window only once", () => {
		const { w, calls } = fakeWindow();
		hook.tame(w);
		hook.tame(w);
		w.show();
		expect(calls.filter((c) => c === "showInactive")).toHaveLength(1);
		expect(calls.filter((c) => c.startsWith("focusable"))).toHaveLength(1);
	});

	it("arms one creation listener that tames the window inside the event", () => {
		const once = vi.fn();
		hook.armOnce({ once, removeListener: vi.fn() });
		expect(once).toHaveBeenCalledTimes(1);
		expect(once.mock.calls[0][0]).toBe("browser-window-created");
		const { w, calls } = fakeWindow(4);
		(once.mock.calls[0][1] as (e: unknown, w: unknown) => void)({}, w);
		w.show();
		expect(w.focusable).toBe(false);
		expect(calls.at(-1)).toBe("showInactive");
	});

	it("disarm removes a listener that never fired, so it can't catch a later window", () => {
		const f = fakeApp();
		hook.armOnce(f.app);
		expect(f.listeners.size).toBe(1);
		hook.disarm();
		expect(f.listeners.size).toBe(0);
		const { w } = fakeWindow(9);
		f.create(w);
		expect(w.focusable).toBe(true);
	});

	it("arming again replaces the previous listener instead of stacking", () => {
		const f = fakeApp();
		hook.armOnce(f.app);
		hook.armOnce(f.app);
		expect(f.listeners.size).toBe(1);
		hook.disarm();
	});

	it("installs the show/focus overrides before the native calls, so a show during them is inactive", () => {
		const { w, calls } = fakeWindow(7);
		const real = w.setFocusable.bind(w);
		w.setFocusable = (v: boolean) => {
			w.show();
			real(v);
		};
		hook.tame(w);
		expect(calls).not.toContain("show");
		expect(calls).toContain("showInactive");
	});

	it("a failed tame isn't recorded as done, so the next tame retries it", () => {
		const { w } = fakeWindow(5);
		const real = w.setFocusable.bind(w);
		let fail = true;
		w.setFocusable = (v: boolean) => {
			if (fail) throw new Error("not yet");
			real(v);
		};
		expect(() => hook.tame(w)).toThrow(/not yet/);
		fail = false;
		hook.tame(w);
		expect(w.focusable).toBe(false);
	});

	it("a tame that fails inside the creation event doesn't throw into Electron", () => {
		const f = fakeApp();
		hook.armOnce(f.app);
		const { w } = fakeWindow(6);
		w.setFocusable = () => {
			throw new Error("boom");
		};
		expect(() => f.create(w)).not.toThrow();
	});
});

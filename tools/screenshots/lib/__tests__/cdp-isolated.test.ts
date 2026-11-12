import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cdp, IsolatedUnsupportedError, type CdpTransport } from "../cdp";

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
		await expect(cdp.openSettingsHidden("agent-console")).rejects.toBeInstanceOf(IsolatedUnsupportedError);
		await expect(cdp.captureSettingsWindow("/tmp/x.png")).rejects.toBeInstanceOf(IsolatedUnsupportedError);
		await expect(cdp.setMobileEmulation(true)).rejects.toBeInstanceOf(IsolatedUnsupportedError);
	});

	it("legacy mode is unchanged: no transport means not isolated", () => {
		expect(new Cdp({ vault: "studio" }).isolated).toBe(false);
		expect(new Cdp({ transport: transport(() => ({})).t }).isolated).toBe(true);
	});
});

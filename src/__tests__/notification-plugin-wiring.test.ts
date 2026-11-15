/**
 * Plugin wiring for the notification registry (I52 round 9).
 *
 * Source-order guard: the plugin must activate the registry (and configure
 * removal by id) in onload, and dispose it before the ACP disconnect in both
 * onunload and the workspace "quit" handler, so a turn ended by the disconnect
 * cannot post an orphan after the teardown sweep. plugin.ts has no unit
 * harness, so this pins the order in the shipped source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "src/plugin.ts"), "utf8");

function body(startMarker: string, endMarker: string): string {
	const start = src.indexOf(startMarker);
	expect(start, `missing ${startMarker}`).toBeGreaterThanOrEqual(0);
	const end = src.indexOf(endMarker, start);
	expect(end, `missing ${endMarker} after ${startMarker}`).toBeGreaterThan(start);
	return src.slice(start, end);
}

describe("notification registry wiring in plugin.ts (I52 round 9)", () => {
	it("onload activates the registry with removal by id", () => {
		const onload = body("async onload()", "attachWindowCloseSweep(window");
		expect(onload).toMatch(/initNotifications\(\{\s*statics: getRemoteNotificationStatics\(\),/);
	});

	it("onunload disposes the registry before disconnecting ACP clients", () => {
		const onunload = body("onunload()", "this._acpClients.clear();");
		const dispose = onunload.indexOf("disposeNotifications()");
		const disconnect = onunload.indexOf("client.disconnect()");
		expect(dispose).toBeGreaterThan(-1);
		expect(disconnect).toBeGreaterThan(dispose);
	});

	it("the quit handler disposes the registry before disconnecting ACP clients", () => {
		const quit = body('this.app.workspace.on("quit"', "this._acpClients.clear();");
		const dispose = quit.indexOf("disposeNotifications()");
		const disconnect = quit.indexOf("client.disconnect()");
		expect(dispose).toBeGreaterThan(-1);
		expect(disconnect).toBeGreaterThan(dispose);
	});
});

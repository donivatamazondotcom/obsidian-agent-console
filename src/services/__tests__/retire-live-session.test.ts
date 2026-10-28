import { describe, it, expect, vi } from "vitest";
import { retireLiveSession } from "../retire-live-session";

/**
 * I210 — the executor for decideSessionIntent's `retire` field. It runs the
 * one side effect the decision names, and falls back to a respawn when
 * session/close fails, because a leaked MCP set costs more than a respawn.
 */
function port(closeImpl?: () => Promise<void>) {
	const calls: string[] = [];
	return {
		calls,
		port: {
			closeLiveSession: vi.fn(async () => {
				calls.push("close");
				if (closeImpl) await closeImpl();
			}),
			respawn: vi.fn(async () => {
				calls.push("respawn");
			}),
			warn: vi.fn(),
		},
	};
}

describe("retireLiveSession", () => {
	it("none → touches nothing", async () => {
		const p = port();
		await expect(retireLiveSession("none", p.port)).resolves.toBe("none");
		expect(p.calls).toEqual([]);
	});

	it("close → closes the session, no respawn", async () => {
		const p = port();
		await expect(retireLiveSession("close", p.port)).resolves.toBe("closed");
		expect(p.calls).toEqual(["close"]);
	});

	it("respawn → respawns, never sends session/close", async () => {
		const p = port();
		await expect(retireLiveSession("respawn", p.port)).resolves.toBe(
			"respawned",
		);
		expect(p.calls).toEqual(["respawn"]);
	});

	it("close that rejects → falls back to a respawn and warns", async () => {
		const p = port(async () => {
			throw new Error("session/close failed");
		});
		await expect(retireLiveSession("close", p.port)).resolves.toBe(
			"respawned-after-close-failed",
		);
		expect(p.calls).toEqual(["close", "respawn"]);
		expect(p.port.warn).toHaveBeenCalledOnce();
	});
});

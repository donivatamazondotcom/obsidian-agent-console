/**
 * Chat Timestamps PR 3: the terminal timing map (spec § Tool-call times).
 *
 * TerminalManager records, per terminal id, when the command last printed,
 * when it exited and when the agent released it. A running row reads it to
 * show `no output yet`, `output Ns ago` or `exited Ns ago`. The entry
 * outlives the 30-second release cleanup, is pruned 10 minutes after release
 * with no timers, and is cleared by killAllTerminals.
 */
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import type AgentClientPlugin from "../../plugin";

class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill = vi.fn();
}

const children: FakeChild[] = [];

vi.mock("child_process", () => {
	const spawn = () => {
		const child = new FakeChild();
		children.push(child);
		return child;
	};
	return { spawn, default: { spawn } };
});

import { TerminalManager } from "../terminal-handler";

const plugin = {
	settings: { windowsWslMode: false, nodePath: "" },
} as unknown as AgentClientPlugin;

const T0 = Date.UTC(2026, 10, 15, 17, 0, 0);
const MIN = 60_000;

let manager: TerminalManager;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	vi.setSystemTime(T0);
	(Platform as unknown as { isDesktopApp: boolean }).isDesktopApp = true;
	children.length = 0;
	manager = new TerminalManager(plugin);
});

afterEach(() => {
	vi.useRealTimers();
});

function spawnOne(): { id: string; child: FakeChild } {
	const id = manager.createTerminal({ command: "sleep 1" });
	return { id, child: children[children.length - 1] };
}

describe("TerminalManager timing map", () => {
	it("starts with no output, so a silent command reads as 'no output yet'", () => {
		const { id } = spawnOne();
		expect(manager.getTiming(id)).toEqual({
			lastOutputAt: null,
			exitedAt: null,
			releasedAt: null,
		});
	});

	it("records the last stdout or stderr chunk and the exit", () => {
		const { id, child } = spawnOne();
		vi.setSystemTime(T0 + 5_000);
		child.stdout.emit("data", Buffer.from("tick 1\n"));
		vi.setSystemTime(T0 + 9_000);
		child.stderr.emit("data", Buffer.from("warn\n"));
		expect(manager.getTiming(id)?.lastOutputAt).toBe(T0 + 9_000);

		vi.setSystemTime(T0 + 12_000);
		child.emit("exit", 0, null);
		expect(manager.getTiming(id)?.exitedAt).toBe(T0 + 12_000);
	});

	it("records a spawn error as the exit", () => {
		const { id, child } = spawnOne();
		vi.setSystemTime(T0 + 1_000);
		child.emit("error", new Error("ENOENT"));
		expect(manager.getTiming(id)?.exitedAt).toBe(T0 + 1_000);
	});

	it("returns nothing for a terminal id it never spawned (Codex's own ids)", () => {
		expect(manager.getTiming("codex-terminal-1")).toBeNull();
	});

	it("keeps the entry past the 30-second release cleanup", () => {
		const { id, child } = spawnOne();
		child.emit("exit", 0, null);
		vi.setSystemTime(T0 + 1_000);
		manager.releaseTerminal(id);
		expect(manager.getTiming(id)?.releasedAt).toBe(T0 + 1_000);

		vi.advanceTimersByTime(31_000);
		expect(manager.getOutput(id)).toBeNull();
		expect(manager.getTiming(id)?.exitedAt).toBe(T0);
	});

	it("prunes an entry released more than 10 minutes earlier, on the next create or release", () => {
		const first = spawnOne();
		first.child.emit("exit", 0, null);
		manager.releaseTerminal(first.id);

		vi.setSystemTime(T0 + 10 * MIN);
		spawnOne();
		expect(manager.getTiming(first.id)).not.toBeNull();

		vi.setSystemTime(T0 + 10 * MIN + 1);
		const third = spawnOne();
		expect(manager.getTiming(first.id)).toBeNull();
		expect(manager.getTiming(third.id)).not.toBeNull();
	});

	it("never prunes an entry that hasn't been released", () => {
		const { id } = spawnOne();
		vi.setSystemTime(T0 + 60 * MIN);
		spawnOne();
		expect(manager.getTiming(id)).not.toBeNull();
	});

	it("clears the map on killAllTerminals, and a later exit doesn't recreate it", () => {
		const { id, child } = spawnOne();
		manager.killAllTerminals();
		expect(manager.getTiming(id)).toBeNull();
		child.emit("exit", null, "SIGTERM");
		child.stdout.emit("data", Buffer.from("late\n"));
		expect(manager.getTiming(id)).toBeNull();
	});

	it("hands out a copy, so a reader can't change the record", () => {
		const { id } = spawnOne();
		const t = manager.getTiming(id);
		if (t) t.exitedAt = 1;
		expect(manager.getTiming(id)?.exitedAt).toBeNull();
	});
});

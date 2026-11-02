/**
 * I209 — reconnect seam (spec § 3, § 6 test 6).
 *
 * A released tab (and a never-activated restored tab) reconnects with no live
 * process. Before I209 the restored-tab load called `acpClient.loadSession`
 * straight away; on a disconnected client that throws, so the tab fell
 * through to new-plus-transcript and showed the lossy notice for a session
 * the agent still had.
 *
 * Seam (R2): `reconnectExistingSession`, the function ChatPanel's
 * `loadExistingSession` callback calls. Only the ACP client port is faked
 * (R4): its `loadSession` / `resumeSession` throw while the client is not
 * initialized, like the real `requireConnection()`. Assertions are on the
 * result, the call order and what the UI is told (R3). Literals only (R5).
 *
 * Spec: [[I209 Idle tabs never release their agent process]].
 */
import { describe, expect, it, vi } from "vitest";
import {
	reconnectExistingSession,
	type ReconnectClientPort,
} from "../loadExistingSessionFlow";
import {
	NO_AGENT_CAPABILITIES,
	type AgentCapabilities,
	type SessionResult,
} from "../../types/session";

function fakeClient(opts: {
	initialized?: boolean;
	capabilities?: Partial<AgentCapabilities>;
	resume?: "ok" | "throws";
	load?: "ok" | "throws";
}) {
	const calls: string[] = [];
	let initialized = opts.initialized ?? false;
	const caps: AgentCapabilities = {
		...NO_AGENT_CAPABILITIES,
		restoresViaLoad: true,
		...opts.capabilities,
	};
	const requireConnection = () => {
		if (!initialized) throw new Error("Connection not initialized");
	};
	const client: ReconnectClientPort = {
		isInitialized: () => initialized,
		getInitializeResult: () => (initialized ? { capabilities: caps } : null),
		loadSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			calls.push(`load:${sid}`);
			requireConnection();
			if (opts.load === "throws") throw new Error("load failed");
			return { sessionId: sid };
		}),
		resumeSession: vi.fn(async (sid: string): Promise<SessionResult> => {
			calls.push(`resume:${sid}`);
			requireConnection();
			if (opts.resume === "throws") throw new Error("resume failed");
			return { sessionId: sid };
		}),
	};
	const initialize = vi.fn(async () => {
		calls.push("initialize");
		initialized = true;
	});
	return { client, initialize, calls };
}

function run(
	c: ReturnType<typeof fakeClient>,
	haveLocalHistory: boolean,
	extra: { onResumeError?: (e: unknown) => void } = {},
) {
	const onLoaded = vi.fn();
	const setIgnoreUpdates = vi.fn();
	const result = reconnectExistingSession({
		sessionId: "s1",
		cwd: "/vault",
		client: c.client,
		initialize: c.initialize,
		haveLocalHistory: () => haveLocalHistory,
		onLoaded,
		setIgnoreUpdates,
		...extra,
	});
	return { result, onLoaded, setIgnoreUpdates };
}

describe("I209 reconnectExistingSession", () => {
	it("initializes a disconnected client before loading", async () => {
		const c = fakeClient({ initialized: false });
		const { result } = run(c, true);
		expect(await result).toEqual({ ok: true, sessionId: "s1" });
		expect(c.calls).toEqual(["initialize", "load:s1"]);
	});

	it("does not re-initialize a live client", async () => {
		const c = fakeClient({ initialized: true });
		await run(c, true).result;
		expect(c.initialize).not.toHaveBeenCalled();
		expect(c.calls).toEqual(["load:s1"]);
	});

	it("a failed initialize fails the reconnect without loading", async () => {
		const c = fakeClient({ initialized: false });
		c.initialize.mockRejectedValueOnce(new Error("spawn failed"));
		const out = await run(c, true).result;
		expect(out.ok).toBe(false);
		expect(c.calls).toEqual([]);
	});

	it("prefers resume when advertised and local history is shown", async () => {
		const c = fakeClient({ capabilities: { restoresViaResume: true } });
		const { result, onLoaded } = run(c, true);
		expect(await result).toEqual({ ok: true, sessionId: "s1" });
		expect(c.calls).toEqual(["initialize", "resume:s1"]);
		expect(onLoaded).toHaveBeenCalledWith({ sessionId: "s1" });
	});

	it("a failed resume falls back to load", async () => {
		const onResumeError = vi.fn();
		const c = fakeClient({
			capabilities: { restoresViaResume: true },
			resume: "throws",
		});
		const { result } = run(c, true, { onResumeError });
		expect(await result).toEqual({ ok: true, sessionId: "s1" });
		expect(c.calls).toEqual(["initialize", "resume:s1", "load:s1"]);
		expect(onResumeError).toHaveBeenCalledTimes(1);
	});

	it("resume and load both failing fails the reconnect (caller falls back to new)", async () => {
		const c = fakeClient({
			capabilities: { restoresViaResume: true },
			resume: "throws",
			load: "throws",
		});
		const out = await run(c, true).result;
		expect(out.ok).toBe(false);
		expect(c.calls).toEqual(["initialize", "resume:s1", "load:s1"]);
	});

	it("with no local history, loads (replay is the only source) even if resume is advertised", async () => {
		const c = fakeClient({ capabilities: { restoresViaResume: true } });
		const { result, setIgnoreUpdates } = run(c, false);
		expect(await result).toEqual({ ok: true, sessionId: "s1" });
		expect(c.calls).toEqual(["initialize", "load:s1"]);
		expect(setIgnoreUpdates).not.toHaveBeenCalled();
	});

	it("suppresses the replay while loading when local history is shown", async () => {
		const c = fakeClient({});
		const { result, setIgnoreUpdates } = run(c, true);
		await result;
		expect(setIgnoreUpdates.mock.calls).toEqual([[true], [false]]);
	});

	it("reads local history at call time, not from a mount snapshot", async () => {
		// A tab that started fresh has no restored messages at mount, but has a
		// transcript by the time it is released. The flow must see that.
		const c = fakeClient({});
		let count = 0;
		const setIgnoreUpdates = vi.fn();
		const pending = reconnectExistingSession({
			sessionId: "s1",
			cwd: "/vault",
			client: c.client,
			initialize: c.initialize,
			haveLocalHistory: () => count > 0,
			onLoaded: vi.fn(),
			setIgnoreUpdates,
		});
		count = 4;
		await pending;
		expect(setIgnoreUpdates.mock.calls).toEqual([[true], [false]]);
	});
});

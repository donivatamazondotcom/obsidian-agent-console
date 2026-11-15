/**
 * Chat ID — the `obsidian://agent-console-chat` handler
 * ([[Agent Console Chat ID]] § Public surface, D8, D12, D14, D15).
 *
 * Seams (R2): the real `createChatLinkHandler`, the real `deriveChatTarget`,
 * `parseChatLinkParams` and `checkChatLinkRateLimit` it runs, and the real
 * i18n notices. Fakes only at the declared boundaries (R4): the Obsidian
 * `Workspace`, the leaves (each with its own window, whose frames the fake
 * counts), the per-panel bridges and the plugin methods.
 *
 * Assertions (R3): which leaf was revealed and focused and in what order,
 * which bridge switched or opened what, the notices, and the rate-limit
 * state. Literals (R5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatLinkHandler } from "../chat-link-handler";
import type {
	BoundChat,
	ChatLinkHandlerInputs,
	ChatLinkLeaf,
	ChatLinkRateLimitState,
	OpenChatBridge,
	OpenRecordResult,
} from "../../types/chat-link";
import type { SavedSessionInfo } from "../../types/session";
import type { PerLeafTabState } from "../../types/tab";

const VIEW = "agent-client-chat-view";

const MISSING =
	"[Agent Console] This chat isn't in this vault's history. It may have been deleted.";
const PANEL_FAILED =
	"[Agent Console] Couldn't open the chat panel. Try the link again.";
const TOO_FAST =
	"[Agent Console] Links are opening too fast. Wait a moment and try again.";
const BAD_ID =
	'[Agent Console] The link\'s "id" value is missing or empty. Nothing was opened.';

function record(recordId: string, sessionId = `s-${recordId}`): SavedSessionInfo {
	return {
		recordId,
		sessionId,
		agentId: "kiro",
		cwd: "/vault",
		title: `Chat ${recordId}`,
		createdAt: "2026-11-02T09:00:00.000Z",
		updatedAt: "2026-11-02T09:05:00.000Z",
	};
}

/**
 * A window whose frame requests the fake counts; frames run on the macrotask
 * queue. A stalled window (a closed or minimized popout) never calls back.
 */
function fakeWindow(name: string, opts: { stalled?: boolean } = {}) {
	const win = {
		name,
		frames: 0,
		requestAnimationFrame(cb: (t: number) => void) {
			win.frames++;
			if (opts.stalled) return 0;
			return setTimeout(() => cb(0), 0) as unknown as number;
		},
	};
	return win;
}

interface FakeLeaf extends ChatLinkLeaf {
	id: string;
	win: ReturnType<typeof fakeWindow>;
	/** Frames after a reveal before a deferred view's bridge registers; null = never. */
	mountAfterFrames?: number | null;
	/** The bridge it registers on mount. */
	pendingBridge?: FakeBridge;
	/** Fake ms a reveal of this leaf takes (the clock moves by it). */
	revealCost?: number;
	/** Register the bridge on a timer after a reveal, not on frames. */
	mountOnTimer?: boolean;
	/** Runs inside revealLeaf (e.g. the leaf closes as it loads). */
	onReveal?: () => void;
}

interface FakeBridge extends OpenChatBridge {
	bound: BoundChat[];
	switched: string[];
	opened: string[];
}

/**
 * A bridge over a fake panel. `openFromHistory` adds a tab that reports its
 * chat ID only after `reportAfterFrames` frames on the panel's window, as a
 * mounted tab reports a little after React renders it.
 */
function fakeBridge(
	leaf: () => FakeLeaf,
	bound: BoundChat[] = [],
	opts: { result?: OpenRecordResult; reportAfterFrames?: number } = {},
): FakeBridge {
	const b: FakeBridge = {
		bound,
		switched: [],
		opened: [],
		boundChatIds: () => [...b.bound],
		switchTo: (tabId) => {
			b.switched.push(tabId);
		},
		openFromHistory: async (rec) => {
			b.opened.push(rec.recordId);
			const result = opts.result ?? "opened";
			if (result === "opened") {
				let left = opts.reportAfterFrames ?? 0;
				const report = () => {
					if (left-- <= 0) {
						b.bound.push({ tabId: `tab-${rec.recordId}`, chatId: rec.recordId });
						return;
					}
					leaf().win.requestAnimationFrame(report);
				};
				report();
			}
			return result;
		},
	};
	return b;
}

function makeLeaf(id: string, win = fakeWindow(id)): FakeLeaf {
	return {
		id,
		win,
		view: { containerEl: { win } as unknown as HTMLElement },
	};
}

interface EnvOpts {
	layoutReady?: boolean;
	restoreTabsOnStartup?: boolean;
	perLeafTabStates?: PerLeafTabState[];
	records?: SavedSessionInfo[];
	focusedLeafId?: string | null;
	/** Run when activateView is called with no chat leaf open. */
	createLeafOnActivate?: () => FakeLeaf;
	/** Override getTargetChatLeaf (default: the first chat leaf). */
	targetLeaf?: () => FakeLeaf | null;
	/** Override waitForChatViewOpener. */
	opener?: () => Promise<{ leaf: FakeLeaf } | null>;
	/** activateView creates a leaf even when other chat leaves exist. */
	createEvenIfLeaves?: boolean;
}

function makeEnv(opts: EnvOpts = {}) {
	const leaves: FakeLeaf[] = [];
	const bridges = new Map<FakeLeaf, FakeBridge | null>();
	const events: string[] = [];
	const notices: string[] = [];
	const errors: unknown[] = [];
	let ready = opts.layoutReady ?? true;
	const readyCallbacks: Array<() => void> = [];
	let rate: ChatLinkRateLimitState = {};
	// The fake clock: fire() sets it; each sleep tick moves it by its length.
	const clock = { t: 0 };
	const timed: Array<{ event: string; t: number }> = [];
	let rejectReveals = 0;
	let activations = 0;

	const mount = (leaf: FakeLeaf) => {
		if (leaf.mountOnTimer) {
			setTimeout(() => bridges.set(leaf, leaf.pendingBridge ?? null), 0);
			return;
		}
		if (leaf.mountAfterFrames === null || leaf.mountAfterFrames === undefined)
			return;
		let left = leaf.mountAfterFrames;
		const tick = () => {
			if (left-- <= 0) {
				bridges.set(leaf, leaf.pendingBridge ?? null);
				return;
			}
			leaf.win.requestAnimationFrame(tick);
		};
		tick();
	};

	const inputs: ChatLinkHandlerInputs<FakeLeaf> = {
		workspace: {
			getLeavesOfType: (type) => (type === VIEW ? [...leaves] : []),
			onLayoutReady: (cb) => {
				if (ready) cb();
				else readyCallbacks.push(cb);
			},
			revealLeaf: async (leaf) => {
				events.push(`reveal:${leaf.id}`);
				timed.push({ event: `reveal:${leaf.id}`, t: clock.t });
				leaf.onReveal?.();
				if (leaf.revealCost) {
					await new Promise((r) => setTimeout(r, 0));
					clock.t += leaf.revealCost;
				}
				if (rejectReveals > 0) {
					rejectReveals--;
					throw new Error("reveal failed");
				}
				if (!bridges.get(leaf)) mount(leaf);
			},
			setActiveLeaf: (leaf, params) => {
				events.push(`active:${leaf.id}:${params.focus}`);
				timed.push({ event: `active:${leaf.id}`, t: clock.t });
			},
		},
		viewType: VIEW,
		getBridge: (leaf) => bridges.get(leaf) ?? null,
		restoreTabsOnStartup: () => opts.restoreTabsOnStartup ?? true,
		perLeafTabStates: () => opts.perLeafTabStates ?? [],
		savedSessions: () => opts.records ?? [],
		lastActiveChatViewId: () => opts.focusedLeafId ?? null,
		getTargetChatLeaf: () =>
			opts.targetLeaf ? opts.targetLeaf() : (leaves[0] ?? null),
		activateView: async () => {
			activations++;
			events.push("activateView");
			if (
				opts.createLeafOnActivate &&
				(leaves.length === 0 || opts.createEvenIfLeaves)
			) {
				const leaf = opts.createLeafOnActivate();
				leaves.push(leaf);
				mount(leaf);
			}
		},
		waitForChatViewOpener:
			opts.opener ??
			(async () => {
				const leaf = leaves[0];
				return leaf ? { leaf } : null;
			}),
		rateLimit: {
			get: () => rate,
			set: (s) => {
				rate = s;
			},
		},
		now: () => clock.t,
		sleep: (ms) =>
			new Promise<void>((r) =>
				setTimeout(() => {
					clock.t += ms;
					r();
				}, 0),
			),
		notify: (m) => {
			notices.push(m);
			timed.push({ event: `notice:${m}`, t: clock.t });
		},
		logError: (_m, e) => errors.push(e),
	};

	const handler = createChatLinkHandler(inputs);
	return {
		handler,
		leaves,
		bridges,
		events,
		notices,
		errors,
		addLeaf(leaf: FakeLeaf, bridge: FakeBridge | null) {
			leaves.push(leaf);
			bridges.set(leaf, bridge);
			return leaf;
		},
		fire(params: Record<string, string | undefined>, at: number) {
			clock.t = at;
			return handler(params);
		},
		clock,
		timed,
		/** The leaf closes, but its bridge hasn't been cleared yet. */
		detachLeafKeepingBridge(leaf: FakeLeaf) {
			const i = leaves.indexOf(leaf);
			if (i >= 0) leaves.splice(i, 1);
		},
		removeLeaf(leaf: FakeLeaf) {
			const i = leaves.indexOf(leaf);
			if (i >= 0) leaves.splice(i, 1);
			bridges.delete(leaf);
		},
		/** Let the run go on until an event starting with `prefix` is recorded. */
		async untilEvent(prefix: string) {
			for (let i = 0; i < 5000; i++) {
				if (timed.some((e) => e.event.startsWith(prefix))) return;
				await new Promise((r) => setTimeout(r, 0));
			}
		},
		/** Let fake time pass until the clock reaches `t`. */
		async untilClock(t: number) {
			for (let i = 0; i < 5000 && clock.t < t; i++) {
				await new Promise((r) => setTimeout(r, 0));
			}
		},
		setLayoutReady() {
			ready = true;
			for (const cb of readyCallbacks.splice(0)) cb();
		},
		rejectNextReveals(n: number) {
			rejectReveals = n;
		},
		rateState: () => rate,
		activations: () => activations,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Parse and rate limit
// ---------------------------------------------------------------------------

describe("chat link handler — rate limit and bad links", () => {
	it("T35: within 2 s the same id is dropped silently, another shows the notice; neither moves the window", async () => {
		const env = makeEnv({ records: [record("a"), record("b")] });
		const leaf = env.addLeaf(makeLeaf("L"), null);
		env.bridges.set(leaf, fakeBridge(() => leaf));
		await env.fire({ id: "a" }, 0);
		await env.fire({ id: "a" }, 1000);
		expect(env.notices).toEqual([]);
		await env.fire({ id: "b" }, 1500);
		expect(env.notices).toEqual([TOO_FAST]);
		expect(env.rateState()).toEqual({ lastAt: 0, lastId: "a" });
		// 2.5 s after the first: handled.
		await env.fire({ id: "b" }, 2500);
		expect(env.rateState()).toEqual({ lastAt: 2500, lastId: "b" });
		const bridge = env.bridges.get(leaf)!;
		expect(bridge.opened).toEqual(["a", "b"]);
	});

	it("T43: no id or a blank id shows the bad-link notice, opens nothing, and counts against the limit", async () => {
		const env = makeEnv({ records: [record("a")] });
		const leaf = env.addLeaf(makeLeaf("L"), null);
		env.bridges.set(leaf, fakeBridge(() => leaf));
		await env.fire({}, 0);
		expect(env.notices).toEqual([BAD_ID]);
		await env.fire({ id: "   " }, 2500);
		expect(env.notices).toEqual([BAD_ID, BAD_ID]);
		expect(env.rateState()).toEqual({ lastAt: 2500, lastId: "" });
		await env.fire({ id: "a" }, 3000);
		expect(env.notices).toEqual([BAD_ID, BAD_ID, TOO_FAST]);
		expect(env.events).toEqual([]);
		expect(env.bridges.get(leaf)!.opened).toEqual([]);
	});

	it("T41: while the first link waits for layout-ready, a second within 2 s is dropped or rate-limited", async () => {
		const env = makeEnv({ layoutReady: false, records: [record("a"), record("b")] });
		const leaf = env.addLeaf(makeLeaf("L"), null);
		env.bridges.set(leaf, fakeBridge(() => leaf));
		const first = env.fire({ id: "a" }, 0);
		await env.fire({ id: "a" }, 1000);
		await env.fire({ id: "b" }, 1500);
		expect(env.notices).toEqual([TOO_FAST]);
		expect(env.events).toEqual([]);
		env.setLayoutReady();
		await first;
		expect(env.bridges.get(leaf)!.opened).toEqual(["a"]);
		expect(env.notices).toEqual([TOO_FAST]);
	});
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

describe("chat link handler — a chat open in a panel", () => {
	it("T14: a chat open in another leaf switches to it, reveals and focuses that leaf, with no new tab", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a, [{ tabId: "a1", chatId: "y" }]));
		const b = env.addLeaf(makeLeaf("B"), null);
		env.bridges.set(b, fakeBridge(() => b, [{ tabId: "b1", chatId: "x" }]));
		await env.fire({ id: "x" }, 0);
		expect(env.bridges.get(b)!.switched).toEqual(["b1"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
		expect(env.bridges.get(b)!.opened).toEqual([]);
		expect(env.events).toEqual(["reveal:B", "active:B:true"]);
		expect(env.notices).toEqual([]);
	});

	it("T26: the same link twice, 3 s apart, lands on the chat both times", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a));
		await env.fire({ id: "x" }, 0);
		await env.fire({ id: "x" }, 3000);
		const bridge = env.bridges.get(a)!;
		expect(bridge.opened).toEqual(["x"]);
		expect(bridge.switched).toEqual(["tab-x"]);
		expect(env.notices).toEqual([]);
	});
});

describe("chat link handler — a chat in a panel that hasn't mounted", () => {
	function deferredWithChat(
		savedTab: { recordId?: string; sessionId: string },
		viewIdDiffers = false,
	) {
		const env = makeEnv({
			records: [record("x", "s-x")],
			perLeafTabStates: [
				{
					leafId: "B",
					activeTabId: "b0",
					tabs: [
						{
							tabId: "b0",
							agentId: "kiro",
							label: "Other",
							sessionId: "s-other",
						} as never,
						{
							tabId: "b1",
							agentId: "kiro",
							label: "Chat x",
							...savedTab,
						} as never,
					],
				} as PerLeafTabState,
			],
		});
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a));
		const b = makeLeaf("B");
		if (viewIdDiffers) {
			(b.view as unknown as { viewId: string }).viewId = "view-other";
		}
		b.mountAfterFrames = 2;
		b.pendingBridge = fakeBridge(() => b, [
			{ tabId: "b0", chatId: "rec-other" },
			{ tabId: "b1", chatId: "x" },
		]);
		env.addLeaf(b, null);
		return { env, a, b };
	}

	it("T15: reveals the deferred panel, waits for its bridge, and switches to the tab; no duplicate", async () => {
		const { env, a, b } = deferredWithChat({ recordId: "x", sessionId: "s-x" });
		await env.fire({ id: "x" }, 0);
		expect(b.pendingBridge!.switched).toEqual(["b1"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
		expect(env.events).toEqual(["reveal:B", "reveal:B", "active:B:true"]);
		expect(env.notices).toEqual([]);
	});

	it("T39: the deferred leaf's saved tab state is found by leaf.id when view.viewId differs", async () => {
		const { env, a, b } = deferredWithChat(
			{ recordId: "x", sessionId: "s-x" },
			true,
		);
		await env.fire({ id: "x" }, 0);
		expect(b.pendingBridge!.switched).toEqual(["b1"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
	});

	it("T33: saved tab state from before I269 still resolves to that panel; no other panel gets the chat", async () => {
		const { env, a, b } = deferredWithChat({ sessionId: "s-x" });
		await env.fire({ id: "x" }, 0);
		expect(b.pendingBridge!.switched).toEqual(["b1"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
	});

	it("with Restore tabs on startup off, a deferred panel's leftover state is ignored and the chat opens from history", async () => {
		const env = makeEnv({
			restoreTabsOnStartup: false,
			records: [record("x", "s-x")],
			perLeafTabStates: [
				{
					leafId: "B",
					activeTabId: "b1",
					tabs: [
						{ tabId: "b1", agentId: "kiro", label: "x", recordId: "x", sessionId: "s-x" } as never,
					],
				} as PerLeafTabState,
			],
		});
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a));
		const b = makeLeaf("B");
		b.mountAfterFrames = 1;
		b.pendingBridge = fakeBridge(() => b);
		env.addLeaf(b, null);
		await env.fire({ id: "x" }, 0);
		expect(env.bridges.get(a)!.opened).toEqual(["x"]);
		expect(b.pendingBridge!.switched).toEqual([]);
		expect(env.events).toEqual(["reveal:A", "active:A:true"]);
	});

	it("T29: a deferred panel whose bridge never registers ends in one history tab elsewhere, no missing notice", async () => {
		const { env, a, b } = deferredWithChat({ recordId: "x", sessionId: "s-x" });
		b.mountAfterFrames = null;
		await env.fire({ id: "x" }, 0);
		expect(env.bridges.get(a)!.opened).toEqual(["x"]);
		expect(env.notices).toEqual([]);
		expect(b.win.frames).toBeGreaterThanOrEqual(1);
	});

	it("T29: with no other panel, it ends in the could-not-open notice, no hang, no missing notice", async () => {
		const env = makeEnv({
			records: [record("x", "s-x")],
			perLeafTabStates: [
				{
					leafId: "B",
					activeTabId: "b1",
					tabs: [
						{ tabId: "b1", agentId: "kiro", label: "x", recordId: "x", sessionId: "s-x" } as never,
					],
				} as PerLeafTabState,
			],
		});
		const b = makeLeaf("B");
		b.mountAfterFrames = null;
		env.addLeaf(b, null);
		await env.fire({ id: "x" }, 0);
		expect(env.notices).toEqual([PANEL_FAILED]);
	});
});

describe("chat link handler — a chat in history", () => {
	it("T32: opens it in the bridged panel, then reveals and focuses that panel", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = env.addLeaf(makeLeaf("A"), null);
		const bridge = fakeBridge(() => a, [], { reportAfterFrames: 3 });
		env.bridges.set(a, bridge);
		await env.fire({ id: "x" }, 0);
		expect(bridge.opened).toEqual(["x"]);
		expect(env.events).toEqual(["reveal:A", "active:A:true"]);
		expect(env.notices).toEqual([]);
	});

	it("prefers the focus-tracked bridged panel", async () => {
		const env = makeEnv({ records: [record("x")], focusedLeafId: "B" });
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a));
		const b = env.addLeaf(makeLeaf("B"), null);
		env.bridges.set(b, fakeBridge(() => b));
		await env.fire({ id: "x" }, 0);
		expect(env.bridges.get(b)!.opened).toEqual(["x"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
	});

	it("T16: with no chat view open, opens a panel and opens the chat in it", async () => {
		let created: FakeLeaf | null = null;
		const env = makeEnv({
			records: [record("x")],
			createLeafOnActivate: () => {
				const leaf = makeLeaf("New");
				leaf.mountAfterFrames = 1;
				leaf.pendingBridge = fakeBridge(() => leaf);
				created = leaf;
				return leaf;
			},
		});
		await env.fire({ id: "x" }, 0);
		expect(env.activations()).toBe(1);
		expect(created!.pendingBridge!.opened).toEqual(["x"]);
		expect(env.events.slice(-2)).toEqual(["reveal:New", "active:New:true"]);
		expect(env.notices).toEqual([]);
	});

	it("T21 (handler half): a reopened panel that brings the chat back is switched to, not opened again", async () => {
		let created: FakeLeaf | null = null;
		const env = makeEnv({
			records: [record("x")],
			createLeafOnActivate: () => {
				// activateView brings back the tab set just closed, which holds x.
				const leaf = makeLeaf("Reopened");
				leaf.mountAfterFrames = 1;
				leaf.pendingBridge = fakeBridge(() => leaf, [{ tabId: "r1", chatId: "x" }]);
				created = leaf;
				return leaf;
			},
		});
		await env.fire({ id: "x" }, 0);
		expect(created!.pendingBridge!.switched).toEqual(["r1"]);
		expect(created!.pendingBridge!.opened).toEqual([]);
		expect(env.events.slice(-2)).toEqual(["reveal:Reopened", "active:Reopened:true"]);
	});

	it("T45: a bridge whose open reports gone shows the missing notice", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a, [], { result: "gone" }));
		await env.fire({ id: "x" }, 0);
		expect(env.notices).toEqual([MISSING]);
	});

	it("a chat that isn't in history shows the missing notice and reveals nothing", async () => {
		const env = makeEnv({ records: [] });
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a));
		await env.fire({ id: "nope" }, 0);
		expect(env.notices).toEqual([MISSING]);
		expect(env.events).toEqual([]);
	});

	it("T42 (different ids): two links, 3 s apart, with no chat view open end in one panel holding both", async () => {
		const env = makeEnv({
			layoutReady: false,
			records: [record("x"), record("y")],
			createLeafOnActivate: () => {
				const leaf = makeLeaf(`New-${env.activations()}`);
				leaf.mountAfterFrames = 2;
				leaf.pendingBridge = fakeBridge(() => leaf, [], { reportAfterFrames: 2 });
				return leaf;
			},
		});
		const first = env.fire({ id: "x" }, 0);
		const second = env.fire({ id: "y" }, 3000);
		env.setLayoutReady();
		await Promise.all([first, second]);
		expect(env.leaves).toHaveLength(1);
		expect(env.leaves[0].pendingBridge!.opened).toEqual(["x", "y"]);
		expect(env.notices).toEqual([]);
	});
});

describe("chat link handler — layout-ready, popouts and failures", () => {
	it("T25: a link handled before layout-ready waits, then lands on the restored tab with no duplicate", async () => {
		const env = makeEnv({ layoutReady: false, records: [record("x")] });
		const pending = env.fire({ id: "x" }, 0);
		await new Promise((r) => setTimeout(r, 5));
		expect(env.events).toEqual([]);
		const a = env.addLeaf(makeLeaf("A"), null);
		env.bridges.set(a, fakeBridge(() => a, [{ tabId: "a1", chatId: "x" }]));
		env.setLayoutReady();
		await pending;
		expect(env.bridges.get(a)!.switched).toEqual(["a1"]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
	});

	it("T28: a chat in a popout counts frames on the popout's window and focuses the popout leaf", async () => {
		const mainRaf = vi.spyOn(window, "requestAnimationFrame");
		const env = makeEnv({
			records: [record("x", "s-x")],
			perLeafTabStates: [
				{
					leafId: "P",
					activeTabId: "p1",
					tabs: [
						{ tabId: "p1", agentId: "kiro", label: "x", recordId: "x", sessionId: "s-x" } as never,
					],
				} as PerLeafTabState,
			],
		});
		const popout = makeLeaf("P", fakeWindow("popout"));
		popout.mountAfterFrames = 3;
		popout.pendingBridge = fakeBridge(() => popout, [{ tabId: "p1", chatId: "x" }]);
		env.addLeaf(popout, null);
		await env.fire({ id: "x" }, 0);
		expect(popout.pendingBridge!.switched).toEqual(["p1"]);
		expect(env.events.slice(-1)).toEqual(["active:P:true"]);
		expect(popout.win.frames).toBeGreaterThan(0);
		expect(mainRaf).not.toHaveBeenCalled();
	});

	it("T44: a reveal that rejects before the open shows the could-not-open notice, and the next link still opens", async () => {
		const env = makeEnv({
			records: [record("x", "s-x"), record("y", "s-y")],
			perLeafTabStates: [],
		});
		const b = makeLeaf("B");
		b.mountAfterFrames = 1;
		b.pendingBridge = fakeBridge(() => b);
		env.addLeaf(b, null);
		env.rejectNextReveals(1);
		await env.fire({ id: "x" }, 0);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(env.errors).toHaveLength(1);
		await env.fire({ id: "y" }, 3000);
		expect(b.pendingBridge!.opened).toEqual(["y"]);
		expect(env.notices).toEqual([PANEL_FAILED]);
	});

	it("T44: a reveal that rejects after an open still settles first, so a queued same-id link lands on the tab", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = env.addLeaf(makeLeaf("A"), null);
		const bridge = fakeBridge(() => a, [], { reportAfterFrames: 3 });
		env.bridges.set(a, bridge);
		env.rejectNextReveals(1);
		const first = env.fire({ id: "x" }, 0);
		const second = env.fire({ id: "x" }, 3000);
		await Promise.all([first, second]);
		expect(bridge.opened).toEqual(["x"]);
		expect(bridge.switched).toEqual(["tab-x"]);
		expect(env.notices).toEqual([PANEL_FAILED]);
	});
});

// ---------------------------------------------------------------------------
// Every wait is bounded twice (frames, and 2 s of now() time), a closed leaf
// ends the run, step 5 doesn't re-wait step 4's leaf, and a could-not-open
// notice releases the run's repeat.
// ---------------------------------------------------------------------------

/** One deferred leaf B with saved tab state holding chat x, never mounting. */
function stalledDeferred(opts: EnvOpts = {}) {
	const env = makeEnv({
		records: [record("x", "s-x"), record("y", "s-y")],
		perLeafTabStates: [
			{
				leafId: "B",
				activeTabId: "b1",
				tabs: [
					{ tabId: "b1", agentId: "kiro", label: "x", recordId: "x", sessionId: "s-x" } as never,
				],
			} as PerLeafTabState,
		],
		...opts,
	});
	const b = makeLeaf("B", fakeWindow("B", { stalled: true }));
	b.mountAfterFrames = null;
	env.addLeaf(b, null);
	return { env, b };
}

/** The fake time of the first event matching `prefix`, after index `from`. */
function at(env: ReturnType<typeof makeEnv>, prefix: string, from = 0) {
	return env.timed.slice(from).find((e) => e.event.startsWith(prefix))?.t;
}

describe("chat link handler — every wait is bounded (T48)", () => {
	it("T48: a bridge wait on a window that never draws ends at the 2 s deadline; a link fired while it's stalled then opens", async () => {
		let targetCalls = 0;
		let created: FakeLeaf | null = null;
		const { env, b } = stalledDeferred({
			// Run 1 targets B; run 2 finds no target and opens a panel.
			targetLeaf: () => (targetCalls++ === 0 ? env.leaves[0] : null),
			createEvenIfLeaves: true,
			createLeafOnActivate: () => {
				const leaf = makeLeaf("A");
				leaf.mountAfterFrames = 1;
				leaf.pendingBridge = fakeBridge(() => leaf);
				created = leaf;
				return leaf;
			},
			opener: async () => (created ? { leaf: created } : null),
		});
		b.revealCost = 1000; // the first run is held 1 s before its stalled wait
		const first = env.fire({ id: "x" }, 0);
		await env.untilClock(2400);
		expect(env.notices).toEqual([]);
		// The second link, queued while the first run is stalled.
		const second = env.fire({ id: "y" }, 2500);
		await first;
		expect(env.notices).toEqual([PANEL_FAILED]);
		await Promise.race([
			second,
			new Promise((_, rej) => setTimeout(() => rej(new Error("second link hung")), 2000)),
		]);
		expect(created!.pendingBridge!.opened).toEqual(["y"]);
		expect(env.notices).toEqual([PANEL_FAILED]);
	});

	it("T48: the bridge wait's own length is at least 2 s and under 2 s plus one tick", async () => {
		const { env, b } = stalledDeferred({ targetLeaf: () => null });
		b.revealCost = 1000;
		await env.fire({ id: "x" }, 0);
		const revealed = at(env, "reveal:B")!;
		const ended = at(env, "notice:")!;
		const waitStart = revealed + 1000;
		expect(ended - waitStart).toBeGreaterThanOrEqual(2000);
		expect(ended - waitStart).toBeLessThan(2100);
	});

	it("T48: a settle wait on a window that never draws ends at the deadline with no notice; a later same-id link lands on open-tab", async () => {
		const env = makeEnv({ records: [record("x")] });
		const a = makeLeaf("A", fakeWindow("A", { stalled: true }));
		a.revealCost = 300; // the final reveal is held
		const bridge = fakeBridge(() => a, [], { result: "opened", reportAfterFrames: 999 });
		const open = bridge.openFromHistory;
		let openedAt = -1;
		bridge.openFromHistory = async (rec) => {
			const r = await open(rec);
			openedAt = env.clock.t;
			// The new tab reports on a timer ~100 ms after the deadline.
			void (async () => {
				await env.untilClock(openedAt + 2100);
				bridge.bound.push({ tabId: "tab-x", chatId: "x" });
			})();
			return r;
		};
		env.addLeaf(a, bridge);
		const first = env.fire({ id: "x" }, 0);
		// Fire the second link while the first run is held in its final reveal.
		await env.untilEvent("reveal:A");
		const second = env.fire({ id: "x" }, 2500);
		await Promise.race([
			Promise.all([first, second]),
			new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 3000)),
		]);
		const settled = at(env, "reveal:A")!;
		expect(settled - openedAt).toBeGreaterThanOrEqual(2000);
		expect(settled - openedAt).toBeLessThan(2100);
		expect(env.notices).toEqual([]);
		expect(bridge.opened).toEqual(["x"]);
		expect(bridge.switched).toEqual(["tab-x"]);
	});

	it("T48: a bridge that registers while its window draws no frames ends the wait at the next tick", async () => {
		const env = makeEnv({
			records: [record("x", "s-x")],
			perLeafTabStates: [
				{
					leafId: "B",
					activeTabId: "b1",
					tabs: [
						{ tabId: "b1", agentId: "kiro", label: "x", recordId: "x", sessionId: "s-x" } as never,
					],
				} as PerLeafTabState,
			],
		});
		const b = makeLeaf("B", fakeWindow("B", { stalled: true }));
		b.mountOnTimer = true;
		b.pendingBridge = fakeBridge(() => b, [{ tabId: "b1", chatId: "x" }]);
		env.addLeaf(b, null);
		await env.fire({ id: "x" }, 0);
		expect(b.pendingBridge.switched).toEqual(["b1"]);
		expect(at(env, "active:B")!).toBeLessThan(500);
	});
});

describe("chat link handler — a leaf that closes during a wait (T48c)", () => {
	it("during step 4's bridge wait: no reveal or focus after, could-not-open, and a retry lands on history", async () => {
		const { env, b } = stalledDeferred();
		const a = makeLeaf("A");
		env.addLeaf(a, fakeBridge(() => a));
		const run = env.fire({ id: "x" }, 0);
		await env.untilClock(500);
		const mark = env.events.length;
		env.removeLeaf(b);
		await run;
		expect(env.events.slice(mark)).toEqual([]);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(env.bridges.get(a)!.opened).toEqual([]);
		// The wait ends soon after the leaf closes, not at the 2 s deadline,
		// and the could-not-open notice releases the run's repeat.
		expect(at(env, "notice:")!).toBeLessThan(1000);
		expect(env.rateState()).toEqual({ lastAt: 0 });
		await env.fire({ id: "x" }, 2500);
		expect(env.bridges.get(a)!.opened).toEqual(["x"]);
	});

	it("during step 5's bridge wait: no reveal, focus or open after, could-not-open, and a retry lands on history", async () => {
		let created: FakeLeaf | null = null;
		const env = makeEnv({
			records: [record("x")],
			createLeafOnActivate: () => {
				const leaf = makeLeaf("New");
				leaf.mountAfterFrames = 1;
				leaf.pendingBridge = fakeBridge(() => leaf);
				created = leaf;
				return leaf;
			},
		});
		// C's bridge registers while C closes, before its bridge is cleared.
		const c = makeLeaf("C");
		c.mountAfterFrames = 1;
		c.pendingBridge = fakeBridge(() => c);
		c.onReveal = () => env.detachLeafKeepingBridge(c);
		env.addLeaf(c, null);
		await env.fire({ id: "x" }, 0);
		expect(env.events).toEqual(["reveal:C"]);
		expect(c.pendingBridge.opened).toEqual([]);
		expect(env.notices).toEqual([PANEL_FAILED]);
		await env.fire({ id: "x" }, 2500);
		expect(created!.pendingBridge!.opened).toEqual(["x"]);
	});

	it("during the settle wait: no final reveal or focus, could-not-open, and a retry lands on history", async () => {
		let created: FakeLeaf | null = null;
		const env = makeEnv({
			records: [record("x")],
			createLeafOnActivate: () => {
				const leaf = makeLeaf("New");
				leaf.mountAfterFrames = 1;
				leaf.pendingBridge = fakeBridge(() => leaf);
				created = leaf;
				return leaf;
			},
		});
		const a = makeLeaf("A", fakeWindow("A", { stalled: true }));
		const bridge = fakeBridge(() => a, [], { reportAfterFrames: 999 });
		env.addLeaf(a, bridge);
		const run = env.fire({ id: "x" }, 0);
		await env.untilClock(500);
		expect(bridge.opened).toEqual(["x"]);
		env.removeLeaf(a);
		await run;
		expect(env.events).toEqual([]);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(at(env, "notice:")!).toBeLessThan(1000);
		await env.fire({ id: "x" }, 2500);
		expect(created!.pendingBridge!.opened).toEqual(["x"]);
	});
});

describe("chat link handler — the opener wait is bounded (T48d)", () => {
	it("an opener that never resolves ends after the 2 s deadline with the could-not-open notice", { timeout: 4000 }, async () => {
		const env = makeEnv({
			records: [record("x")],
			opener: () => new Promise(() => {}),
		});
		await env.fire({ id: "x" }, 0);
		expect(env.activations()).toBe(1);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(at(env, "notice:")!).toBeGreaterThanOrEqual(2000);
		expect(env.rateState()).toEqual({ lastAt: 0 });
	});
});

describe("chat link handler — no chat view open while the main window is hidden (I369)", () => {
	it("uses the panel activateView opened, even though the opener wait never resolves", async () => {
		let created: FakeLeaf | null = null;
		const env = makeEnv({
			records: [record("x")],
			// The plugin's opener counts main-window frames: none arrive.
			opener: () => new Promise(() => {}),
			createLeafOnActivate: () => {
				const leaf = makeLeaf("New", fakeWindow("New", { stalled: true }));
				leaf.mountOnTimer = true;
				leaf.pendingBridge = fakeBridge(() => leaf);
				created = leaf;
				return leaf;
			},
		});
		await env.fire({ id: "x" }, 0);
		expect(created!.pendingBridge!.opened).toEqual(["x"]);
		expect(env.notices).toEqual([]);
		expect(env.events.slice(-1)).toEqual(["active:New:true"]);
		expect(at(env, "active:New")!).toBeLessThan(1000);
	});
});

describe("chat link handler — a could-not-open notice releases the run's repeat (T49)", () => {
	it("after a reveal that throws before the open, the same link within 2 s shows the rate notice", async () => {
		const env = makeEnv({ records: [record("x"), record("y")] });
		const b = makeLeaf("B");
		b.mountAfterFrames = 1;
		b.pendingBridge = fakeBridge(() => b);
		env.addLeaf(b, null);
		env.rejectNextReveals(1);
		await env.fire({ id: "x" }, 0);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(env.rateState()).toEqual({ lastAt: 0 });
		await env.fire({ id: "x" }, 1000);
		expect(env.notices).toEqual([PANEL_FAILED, TOO_FAST]);
		await env.fire({ id: "y" }, 1500);
		expect(env.notices).toEqual([PANEL_FAILED, TOO_FAST, TOO_FAST]);
		await env.fire({ id: "x" }, 2000);
		expect(b.pendingBridge!.opened).toEqual(["x"]);
	});

	it("the no-bridge branch releases the repeat too", async () => {
		const { env } = stalledDeferred();
		await env.fire({ id: "x" }, 0);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(env.rateState()).toEqual({ lastAt: 0 });
	});

	it("a later link accepted before the first run fails keeps its repeat", async () => {
		const { env, b } = stalledDeferred();
		b.revealCost = 1000; // the first run fails after ~3 s
		const first = env.fire({ id: "x" }, 0);
		await env.untilClock(2400);
		const later = env.fire({ id: "y" }, 2500);
		await first;
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(env.rateState()).toEqual({ lastAt: 2500, lastId: "y" });
		// The later run fails too, and releases only its own repeat.
		await later;
		expect(env.notices).toEqual([PANEL_FAILED, PANEL_FAILED]);
		expect(env.rateState()).toEqual({ lastAt: 2500 });
	});
});

describe("chat link handler — step 5 doesn't re-wait step 4's leaf (T50)", () => {
	it("when step 5 targets the leaf step 4 waited on, it's revealed once and waited on for one bound", async () => {
		const { env, b } = stalledDeferred();
		await env.fire({ id: "x" }, 0);
		expect(env.events.filter((e) => e === "reveal:B")).toEqual(["reveal:B"]);
		expect(env.events).toEqual(["reveal:B"]);
		expect(env.notices).toEqual([PANEL_FAILED]);
		expect(at(env, "notice:")!).toBeLessThan(2200);
		expect(b.win.frames).toBeLessThanOrEqual(121);
	});

	it("when step 5 targets a different leaf C, C is revealed and waited on", async () => {
		const c = makeLeaf("C");
		c.mountAfterFrames = 1;
		c.pendingBridge = fakeBridge(() => c);
		const { env } = stalledDeferred({ targetLeaf: () => c });
		env.addLeaf(c, null);
		await env.fire({ id: "x" }, 0);
		expect(env.events).toEqual(["reveal:B", "reveal:C", "reveal:C", "active:C:true"]);
		expect(c.pendingBridge.opened).toEqual(["x"]);
		expect(env.notices).toEqual([]);
	});
});

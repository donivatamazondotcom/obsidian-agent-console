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

/** A window whose frames the fake counts; frames run on the macrotask queue. */
function fakeWindow(name: string) {
	const win = {
		name,
		frames: 0,
		requestAnimationFrame(cb: (t: number) => void) {
			win.frames++;
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
	let now = 0;
	let rejectReveals = 0;
	let activations = 0;

	const mount = (leaf: FakeLeaf) => {
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
				if (rejectReveals > 0) {
					rejectReveals--;
					throw new Error("reveal failed");
				}
				if (!bridges.get(leaf)) mount(leaf);
			},
			setActiveLeaf: (leaf, params) => {
				events.push(`active:${leaf.id}:${params.focus}`);
			},
		},
		viewType: VIEW,
		getBridge: (leaf) => bridges.get(leaf) ?? null,
		restoreTabsOnStartup: () => opts.restoreTabsOnStartup ?? true,
		perLeafTabStates: () => opts.perLeafTabStates ?? [],
		savedSessions: () => opts.records ?? [],
		lastActiveChatViewId: () => opts.focusedLeafId ?? null,
		getTargetChatLeaf: () => leaves[0] ?? null,
		activateView: async () => {
			activations++;
			events.push("activateView");
			if (leaves.length === 0 && opts.createLeafOnActivate) {
				const leaf = opts.createLeafOnActivate();
				leaves.push(leaf);
				mount(leaf);
			}
		},
		waitForChatViewOpener: async () => {
			const leaf = leaves[0];
			return leaf ? { leaf } : null;
		},
		rateLimit: {
			get: () => rate,
			set: (s) => {
				rate = s;
			},
		},
		now: () => now,
		notify: (m) => notices.push(m),
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
			now = at;
			return handler(params);
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

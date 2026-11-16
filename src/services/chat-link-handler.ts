/**
 * `createChatLinkHandler` — the `obsidian://agent-console-chat?vault=…&id=…`
 * handler ([[Agent Console Chat ID]] § Public surface, D8, D12, D14, D15).
 *
 * Per fire, synchronously: rate-limit (2 s only, D14; the holder is set when
 * the check accepts), then parse. A bad link gets its notice at once and
 * never takes a queue slot. An accepted fire queues behind the run in
 * progress, so runs go one at a time (D15).
 *
 * A run:
 *  1. waits for the workspace layout, so a link that launches Obsidian
 *     doesn't run before the saved layout is back;
 *  2. resolves the chat ID against every live chat leaf (bridged panels
 *     through their bridge; panels with no bridge yet through saved tab
 *     state keyed by `leaf.id`) and the history records (`deriveChatTarget`);
 *  3. `open-tab`: switches that panel to the tab, then reveals and focuses
 *     the leaf;
 *  4. `unmounted-tab`: reveals the leaf (loading a deferred view), waits for
 *     its bridge, resolves again; `open-tab` goes to 3, anything else falls
 *     through to 5;
 *  5. `history`: opens the record in a bridged panel (the focus-tracked one,
 *     else the first); with none, uses the target chat leaf or opens a
 *     panel, reveals it, waits for its bridge and resolves again (or, when
 *     that leaf is the one step 4 already waited on, gives up). A run whose
 *     open adds a tab settles once the bridge reports the chat ID, before the
 *     final reveal and focus, so a queued link for the same chat lands on
 *     `open-tab`;
 *  6. `missing`: says so.
 *
 * It resolves again exactly once after each await that opens or reveals a
 * panel, and never revisits a step, so a panel whose bridge never registers
 * can't make it loop. Every wait is bounded twice: by frames on the target
 * leaf's own window, and by 2 s of `now()` time kept going by main-window
 * `sleep` ticks, so a window that stops drawing (a closed or minimized
 * popout) can't hold the queue. A leaf that closed during a wait or a
 * reveal isn't revealed, focused or opened into. A run that ends with the
 * could-not-open notice (including one that throws) releases its repeat, so a
 * quick retry gets the rate notice; the next queued run still starts.
 */
import { t } from "../i18n";
import { deriveChatTarget, type ChatTarget } from "../resolvers/chat-target";
import {
	checkChatLinkRateLimit,
	parseChatLinkParams,
	releaseChatLinkRepeat,
} from "../utils/chat-uri";
import { findSessionRecord } from "../utils/session-record-key";
import type {
	ChatLinkHandlerInputs,
	ChatLinkLeaf,
	ChatLinkRateLimitState,
	OpenChatBridge,
} from "../types/chat-link";
import type { ChatId, SavedSessionInfo } from "../types/session";

/** Frames a bridge or a new tab's report may take (~2 s at 60 fps). */
const FRAME_BOUND = 120;
/** The same wait measured in `now()` time, for windows that stop drawing. */
const WAIT_MS = 2_000;
/** How often a wait checks its condition when no frame arrives. */
const TICK_MS = 100;

export type ChatLinkFire = (
	params: Readonly<Record<string, string | undefined>>,
) => Promise<void>;

/** A run that ended with the could-not-open notice. */
class CouldNotOpen extends Error {}

export function createChatLinkHandler<L extends ChatLinkLeaf>(
	inputs: ChatLinkHandlerInputs<L>,
): ChatLinkFire {
	const { workspace } = inputs;
	const notify = (message: string) =>
		inputs.notify(t("notices.prefixed", { message }));
	let queue: Promise<void> = Promise.resolve();

	const leafIdOf = (leaf: L): string => leaf.id ?? "";
	const chatLeaves = (): L[] => workspace.getLeavesOfType(inputs.viewType);
	const isLive = (leaf: L): boolean => chatLeaves().includes(leaf);

	/** One frame on the leaf's own window (a popout counts its own frames). */
	const nextFrame = (leaf: L) =>
		new Promise<"frame">((resolve) => {
			leaf.view.containerEl.win.requestAnimationFrame(() => resolve("frame"));
		});
	const nextTick = () =>
		inputs.sleep(TICK_MS).then(() => "tick" as const);

	/**
	 * Wait until `done()` holds, for at most FRAME_BOUND frames on the leaf's
	 * window and WAIT_MS of `now()` time. Reads the condition after every frame
	 * and every tick, and once more at the deadline. One pending frame request
	 * and one pending tick at a time.
	 */
	const waitFor = async (leaf: L, done: () => boolean): Promise<boolean> => {
		const start = inputs.now();
		let frames = 0;
		let frame: Promise<"frame"> | null = null;
		let tick: Promise<"tick"> | null = null;
		for (;;) {
			if (done()) return true;
			if (frames >= FRAME_BOUND || inputs.now() - start >= WAIT_MS) {
				return done();
			}
			frame ??= nextFrame(leaf);
			tick ??= nextTick();
			const which = await Promise.race([frame, tick]);
			if (which === "frame") {
				frames++;
				frame = null;
			} else {
				tick = null;
			}
		}
	};

	const waitForBridge = async (leaf: L): Promise<OpenChatBridge | null> => {
		// A leaf that closes ends the wait at once; the caller then checks it.
		await waitFor(leaf, () => inputs.getBridge(leaf) !== null || !isLive(leaf));
		return inputs.getBridge(leaf);
	};

	/** `promise`, or null once WAIT_MS of `now()` time has passed. */
	const withDeadline = async <T>(promise: Promise<T>): Promise<T | null> => {
		const start = inputs.now();
		let settled = false;
		let value: T | null = null;
		const watched = promise.then(
			(v) => {
				settled = true;
				value = v;
			},
			() => {
				settled = true;
			},
		);
		while (!settled && inputs.now() - start < WAIT_MS) {
			await Promise.race([watched, inputs.sleep(TICK_MS)]);
		}
		return value;
	};

	/** End the run with the could-not-open notice unless the leaf is still open. */
	const assertLive = (leaf: L): void => {
		if (!isLive(leaf)) throw new CouldNotOpen("the chat panel closed");
	};

	/**
	 * Reveal the leaf, then make it active with focus (bringing a popout
	 * forward). Returns false, without focusing, when the leaf closed during
	 * the reveal (its popout window closed, I371).
	 */
	const revealAndFocus = async (leaf: L): Promise<boolean> => {
		await workspace.revealLeaf(leaf);
		if (!isLive(leaf)) return false;
		workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	};

	/**
	 * The reveal after the missing notice. That notice already says why
	 * nothing opened, so a leaf that closed during the reveal, or a reveal
	 * that fails, adds no second notice; a failure is only logged.
	 */
	const revealAfterMissing = async (leaf: L): Promise<void> => {
		try {
			await revealAndFocus(leaf);
		} catch (error) {
			inputs.logError("[ChatLink] couldn't show the chat panel", error);
		}
	};

	/**
	 * `revealAndFocus` for a run that opened or switched to the chat: a leaf
	 * that closed during the reveal ends the run with the could-not-open
	 * notice instead of ending silently (I371).
	 */
	const focusLeaf = async (leaf: L): Promise<void> => {
		if (!(await revealAndFocus(leaf))) {
			throw new CouldNotOpen("the chat panel closed");
		}
	};

	const resolve = (chatId: ChatId): { target: ChatTarget; leaf: L | null } => {
		const leaves = chatLeaves();
		const target = deriveChatTarget(chatId, inputs.savedSessions(), {
			liveLeaves: leaves.map((leaf) => ({
				leafId: leafIdOf(leaf),
				bound: inputs.getBridge(leaf)?.boundChatIds() ?? null,
			})),
			savedTabStates: inputs.perLeafTabStates(),
			restoreTabsOnStartup: inputs.restoreTabsOnStartup(),
		});
		const leaf =
			target.kind === "open-tab" || target.kind === "unmounted-tab"
				? (leaves.find((l) => leafIdOf(l) === target.leafId) ?? null)
				: null;
		return { target, leaf };
	};

	/** Step 3. */
	const openTab = async (leaf: L, tabId: string): Promise<void> => {
		inputs.getBridge(leaf)?.switchTo(tabId);
		await focusLeaf(leaf);
	};

	/** The focus-tracked bridged panel, else the first bridged one. */
	const pickBridgedLeaf = (): L | null => {
		const bridged = chatLeaves().filter((l) => inputs.getBridge(l) !== null);
		const focusedId = inputs.lastActiveChatViewId();
		return (
			bridged.find((l) => focusedId !== null && leafIdOf(l) === focusedId) ??
			bridged[0] ??
			null
		);
	};

	/**
	 * Step 5. `startRecord` is null when step 4 fell through with no record;
	 * `waitedLeaf` is the leaf step 4 already revealed and waited on.
	 */
	const openInHistory = async (
		chatId: ChatId,
		startRecord: SavedSessionInfo | null,
		waitedLeaf: L | null,
	): Promise<void> => {
		let record = startRecord;
		let leaf = pickBridgedLeaf();
		let bridge = leaf ? inputs.getBridge(leaf) : null;
		if (!leaf) {
			leaf = inputs.getTargetChatLeaf();
			if (!leaf) {
				await inputs.activateView();
				// The panel activateView opened is the target leaf now. The
				// opener wait counts main-window frames, which a hidden window
				// never draws (I369), so it's only the fallback.
				leaf =
					inputs.getTargetChatLeaf() ??
					(await withDeadline(inputs.waitForChatViewOpener()))?.leaf ??
					null;
			}
			if (!leaf) throw new CouldNotOpen("no chat panel opened");
			// Step 4 already waited on this leaf and its bridge didn't register;
			// nothing has been awaited since, so waiting again can't help.
			if (leaf === waitedLeaf) throw new CouldNotOpen("no bridge registered");
			await workspace.revealLeaf(leaf);
			bridge = await waitForBridge(leaf);
			assertLive(leaf);
			// Resolve again once: the reopened panel may already hold the chat
			// (activateView brings back the tab set just closed).
			const again = resolve(chatId);
			if (again.target.kind === "open-tab" && again.leaf) {
				await openTab(again.leaf, again.target.tabId);
				return;
			}
			if (again.target.kind === "history") record = again.target.record;
			if (again.target.kind === "missing") record = null;
		}
		if (!bridge) throw new CouldNotOpen("no bridge registered");
		if (!record) {
			notify(t("notices.chatLinkMissing"));
			await revealAfterMissing(leaf);
			return;
		}
		const result = await bridge.openFromHistory(record);
		if (result === "gone") {
			notify(t("notices.chatLinkMissing"));
			await revealAfterMissing(leaf);
			return;
		}
		// Settle before the final reveal, so a failed reveal can't skip it.
		if (result === "opened") {
			const b = bridge;
			await waitFor(
				leaf,
				() =>
					b.boundChatIds().some((bound) => bound.chatId === chatId) ||
					!isLive(leaf),
			);
			assertLive(leaf);
		}
		await focusLeaf(leaf);
	};

	const run = async (chatId: ChatId): Promise<void> => {
		await new Promise<void>((done) => workspace.onLayoutReady(() => done()));
		const first = resolve(chatId);
		switch (first.target.kind) {
			case "open-tab":
				if (first.leaf) await openTab(first.leaf, first.target.tabId);
				return;
			case "missing":
				notify(t("notices.chatLinkMissing"));
				return;
			case "history":
				await openInHistory(chatId, first.target.record, null);
				return;
			case "unmounted-tab": {
				const waited = first.leaf;
				if (waited) {
					await workspace.revealLeaf(waited);
					await waitForBridge(waited);
					assertLive(waited);
				}
				const again = resolve(chatId);
				if (again.target.kind === "open-tab" && again.leaf) {
					await openTab(again.leaf, again.target.tabId);
					return;
				}
				const record =
					again.target.kind === "history"
						? again.target.record
						: (findSessionRecord(inputs.savedSessions(), {
								by: "recordId",
								id: chatId,
							}) ?? null);
				await openInHistory(chatId, record, waited);
				return;
			}
		}
	};

	/** The could-not-open notice, and the release of this run's repeat. */
	const couldNotOpen = (accepted: ChatLinkRateLimitState): void => {
		notify(t("notices.chatLinkPanelFailed"));
		const current = inputs.rateLimit.get();
		const released = releaseChatLinkRepeat(current, accepted);
		if (released !== current) inputs.rateLimit.set(released);
	};

	return (params) => {
		// Parsing is pure; the rate-limit decision comes first. A bad link is
		// rate-limited like any other, with "" as its ID.
		const parsed = parseChatLinkParams(params);
		const gate = checkChatLinkRateLimit(
			inputs.rateLimit.get(),
			parsed.kind === "ok" ? parsed.id : "",
			inputs.now(),
		);
		if (!gate.ok) {
			// A repeat of the same chat within 2 s is a double-click: silent.
			if (gate.reason === "rate-limit") {
				notify(t("chat.quickPrompts.uriRateLimited"));
			}
			return Promise.resolve();
		}
		inputs.rateLimit.set(gate.state);
		if (parsed.kind === "bad-param") {
			notify(t("chat.quickPrompts.uriBadParam", { field: parsed.field }));
			return Promise.resolve();
		}
		const chatId = parsed.id;
		const accepted = gate.state;
		queue = queue
			.then(() => run(chatId))
			.catch((error: unknown) => {
				if (!(error instanceof CouldNotOpen)) {
					inputs.logError("[ChatLink] couldn't open a chat link", error);
				}
				couldNotOpen(accepted);
			})
			// Keep the queue going even if reporting the failure throws.
			.catch((error: unknown) => {
				inputs.logError("[ChatLink] couldn't report a failed chat link", error);
			});
		return queue;
	};
}

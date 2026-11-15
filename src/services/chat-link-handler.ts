/**
 * `createChatLinkHandler` — the `obsidian://agent-console-chat?vault=…&id=…`
 * handler ([[Agent Console Chat ID]] § Public surface, D8, D12, D14, D15).
 *
 * Per fire, synchronously: rate-limit (2 s only, D14; the holder is set only
 * when the check accepts), then parse. A bad link gets its notice at once and
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
 *     panel, reveals it, waits for its bridge and resolves again. A run whose
 *     open adds a tab settles once the bridge reports the chat ID, before the
 *     final reveal and focus, so a queued link for the same chat lands on
 *     `open-tab`;
 *  6. `missing`: says so.
 *
 * It resolves again exactly once after each await that opens or reveals a
 * panel, and never revisits a step, so a panel whose bridge never registers
 * can't make it loop. Every frame wait is bounded and counts frames on the
 * target leaf's own window. A run that throws logs the error, shows the
 * could-not-open notice, and the next queued run still starts.
 */
import { t } from "../i18n";
import { deriveChatTarget, type ChatTarget } from "../resolvers/chat-target";
import { checkChatLinkRateLimit, parseChatLinkParams } from "../utils/chat-uri";
import { findSessionRecord } from "../utils/session-record-key";
import type {
	ChatLinkHandlerInputs,
	ChatLinkLeaf,
	OpenChatBridge,
} from "../types/chat-link";
import type { ChatId, SavedSessionInfo } from "../types/session";

/** Frames a bridge or a new tab's report may take (~2 s at 60 fps). */
const FRAME_BOUND = 120;

export type ChatLinkFire = (
	params: Readonly<Record<string, string | undefined>>,
) => Promise<void>;

export function createChatLinkHandler<L extends ChatLinkLeaf>(
	inputs: ChatLinkHandlerInputs<L>,
): ChatLinkFire {
	const { workspace } = inputs;
	const notify = (message: string) =>
		inputs.notify(t("notices.prefixed", { message }));
	let queue: Promise<void> = Promise.resolve();

	const leafIdOf = (leaf: L): string => leaf.id ?? "";
	const chatLeaves = (): L[] => workspace.getLeavesOfType(inputs.viewType);

	/** One frame on the leaf's own window (a popout counts its own frames). */
	const nextFrame = (leaf: L) =>
		new Promise<void>((resolve) => {
			leaf.view.containerEl.win.requestAnimationFrame(() => resolve());
		});

	const waitForBridge = async (leaf: L): Promise<OpenChatBridge | null> => {
		for (let i = 0; i < FRAME_BOUND; i++) {
			const bridge = inputs.getBridge(leaf);
			if (bridge) return bridge;
			await nextFrame(leaf);
		}
		return inputs.getBridge(leaf);
	};

	/** The settle wait (D15): until the panel reports a tab bound to the chat. */
	const waitForReport = async (
		leaf: L,
		bridge: OpenChatBridge,
		chatId: ChatId,
	): Promise<void> => {
		for (let i = 0; i < FRAME_BOUND; i++) {
			if (bridge.boundChatIds().some((b) => b.chatId === chatId)) return;
			await nextFrame(leaf);
		}
	};

	/** Reveal the leaf, then make it active with focus (bringing a popout forward). */
	const focusLeaf = async (leaf: L): Promise<void> => {
		await workspace.revealLeaf(leaf);
		workspace.setActiveLeaf(leaf, { focus: true });
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

	/** Step 5. `record` is null when step 4 fell through with no record. */
	const openInHistory = async (
		chatId: ChatId,
		startRecord: SavedSessionInfo | null,
	): Promise<void> => {
		let record = startRecord;
		let leaf = pickBridgedLeaf();
		let bridge = leaf ? inputs.getBridge(leaf) : null;
		if (!leaf) {
			leaf = inputs.getTargetChatLeaf();
			if (!leaf) {
				await inputs.activateView();
				leaf = (await inputs.waitForChatViewOpener())?.leaf ?? null;
			}
			if (leaf) {
				await workspace.revealLeaf(leaf);
				bridge = await waitForBridge(leaf);
			}
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
		if (!leaf || !bridge) {
			notify(t("notices.chatLinkPanelFailed"));
			return;
		}
		if (!record) {
			notify(t("notices.chatLinkMissing"));
			await focusLeaf(leaf);
			return;
		}
		const result = await bridge.openFromHistory(record);
		if (result === "gone") notify(t("notices.chatLinkMissing"));
		// Settle before the final reveal, so a failed reveal can't skip it.
		if (result === "opened") await waitForReport(leaf, bridge, chatId);
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
				await openInHistory(chatId, first.target.record);
				return;
			case "unmounted-tab": {
				if (first.leaf) {
					await workspace.revealLeaf(first.leaf);
					await waitForBridge(first.leaf);
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
				await openInHistory(chatId, record);
				return;
			}
		}
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
		queue = queue
			.then(() => run(chatId))
			.catch((error: unknown) => {
				inputs.logError("[ChatLink] couldn't open a chat link", error);
				notify(t("notices.chatLinkPanelFailed"));
			});
		return queue;
	};
}

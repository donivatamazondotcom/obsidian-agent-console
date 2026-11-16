/**
 * A2UI wiring for one chat panel: the detached-send port, the transcript
 * projection, the answers and definitions maps, and the context every
 * message bubble receives (I376).
 *
 * Moved out of ChatPanel so its identity contract can be tested on its own.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { Notice } from "obsidian";
import { createSessionDispatchPort } from "../services/session-dispatch-port";
import {
	deriveLatestSurfaceId,
	deriveSurfaceAnswers,
	deriveSurfaceDefinitions,
	type A2uiSurfaceDefinitionSite,
} from "../services/a2ui/surface-state";
import { activateA2uiButton } from "../services/a2ui/activate";
import {
	createA2uiTurnStore,
	type A2uiTurnStore,
} from "../services/a2ui/turn-store";
import type { QueueEvent } from "../services/queue-orchestration-reducer";
import type { ChatMessage, QueuedMessage } from "../types/chat";
import type { TabSessionState } from "../types/tab";
import type { A2uiBubbleContext } from "../services/a2ui/bubble-context";
import { t } from "../i18n";

/** A ref whose `.current` is read at call time (never captured). */
interface LiveRef<T> {
	readonly current: T;
}

export interface UseA2uiWiringInput {
	messages: readonly ChatMessage[];
	isSending: boolean;
	isQueued: boolean;
	queuePending: QueuedMessage | null;
	sessionState: TabSessionState;
	isRestoringSession: boolean;
	/** Stable (a useCallback); the port is built once per value. */
	queueDispatch: (event: QueueEvent) => void;
	lazyStateRef: LiveRef<TabSessionState>;
	isSendingRef: LiveRef<boolean>;
	isQueuedRef: LiveRef<boolean>;
	sessionHistoryLoadingRef: LiveRef<boolean>;
	handleSendMessageRef: LiveRef<(text: string, attachments: undefined) => Promise<void>>;
	/**
	 * Put the caret back in this tab's composer. Read at click time, so its
	 * identity may change between renders. (Injected rather than imported
	 * so this hook doesn't depend on ui/.)
	 */
	refocusComposer: () => void;
}

export interface UseA2uiWiringResult {
	context: A2uiBubbleContext;
	/** Provide via `A2uiTurnStoreContext`; surface hosts read turn state from it. */
	turnStore: A2uiTurnStore;
}

export function useA2uiWiring(input: UseA2uiWiringInput): UseA2uiWiringResult {
	const {
		messages,
		isSending,
		isQueued,
		queuePending,
		sessionState,
		isRestoringSession,
		queueDispatch,
		lazyStateRef,
		isSendingRef,
		isQueuedRef,
		sessionHistoryLoadingRef,
		handleSendMessageRef,
		refocusComposer,
	} = input;
	const refocusComposerRef = useRef(refocusComposer);
	refocusComposerRef.current = refocusComposer;

	// Detached send seam (D8): reads live tab state through the same refs the
	// quick-prompt bridge uses, but has NO composer thunks — an action send
	// can never clobber an unsent draft. Enablement is decided by the shared
	// resolver (deriveA2uiTabDispatch), so the rendered control and this port
	// can never disagree (A2UI-I08). On a tab with no live session the action
	// is HELD in the queue-of-one and delivered by the connect-flush, exactly
	// as a composer send on an idle tab — flagged detached so the flush skips
	// the composer clear.
	const dispatchPort = useMemo(
		() =>
			createSessionDispatchPort({
				lazyState: () => lazyStateRef.current,
				isSending: () => isSendingRef.current,
				isQueued: () => isQueuedRef.current,
				isRestoringSession: () => sessionHistoryLoadingRef.current,
				sendMessage: (text) => handleSendMessageRef.current(text, undefined),
				holdForAcquisition: (text, surfaceId) => {
					queueDispatch({
						type: "sendWhilePreReady",
						message: { content: text, detachedSurfaceId: surfaceId },
					});
				},
				notify: (message) => {
					new Notice(t("notices.prefixed", { message }));
				},
			}),
		// queueDispatch is a stable useCallback (handlers read through a ref);
		// the refs are stable objects.
		[queueDispatch],
	);

	// Transcript projection for the pure surface-state resolvers (role + text).
	const transcript = useMemo(
		() =>
			messages.map((m) => ({
				role: m.role,
				text: m.content
					.filter(
						(c) => c.type === "text" || c.type === "text_with_context",
					)
					.map((c) => ("text" in c ? c.text : ""))
					.join("\n"),
			})),
		[messages],
	);

	// Content-stable identities: the maps recompute per message change, but
	// keep their previous identity when the contents are unchanged, so the
	// memoized bubbles don't mass-re-render on every streamed chunk.
	const answersRef = useRef<ReadonlyMap<string, string>>(new Map());
	const answers = useMemo(() => {
		const next = deriveSurfaceAnswers(transcript);
		const prev = answersRef.current;
		if (
			prev.size === next.size &&
			Array.from(next).every(([k, v]) => prev.get(k) === v)
		) {
			return prev;
		}
		answersRef.current = next;
		return next;
	}, [transcript]);

	const definitionsRef = useRef<
		ReadonlyMap<string, A2uiSurfaceDefinitionSite>
	>(new Map());
	const definitions = useMemo(() => {
		const next = deriveSurfaceDefinitions(transcript);
		const prev = definitionsRef.current;
		if (
			prev.size === next.size &&
			Array.from(next).every(([k, v]) => {
				const p = prev.get(k);
				return (
					p !== undefined &&
					p.messageIndex === v.messageIndex &&
					p.surfaceIndex === v.surfaceIndex
				);
			})
		) {
			return prev;
		}
		definitionsRef.current = next;
		return next;
	}, [transcript]);

	const context = useMemo<A2uiBubbleContext>(
		() => ({
			answers,
			isFirstDefinition: (surfaceId, site) => {
				const first = definitions.get(surfaceId);
				return (
					first !== undefined &&
					first.messageIndex === site.messageIndex &&
					first.surfaceIndex === site.surfaceIndex
				);
			},
			latestSurfaceId: deriveLatestSurfaceId(definitions),
			// Refocus fires at DISPATCH inside the orchestrator — never awaited
			// behind the send promise, which resolves only at turn end (the
			// I173 class; round-1 awaited it and the caret came back minutes
			// late — A2UI-I01).
			onActivate: (surface, button) =>
				activateA2uiButton({
					port: dispatchPort,
					surfaceId: surface.surfaceId,
					button,
					now: () => new Date().toISOString(),
					refocusComposer: () => refocusComposerRef.current(),
				}),
		}),
		// No turn state here (I376): this object reaches every bubble, so it
		// changes only when a surface is defined or answered.
		[answers, definitions, dispatchPort],
	);

	// An action held for reconnect owns the surface's pending state, so a
	// released slot (failed reconnect) re-enables it (A2UI-I08).
	// Turn state lives in a per-panel store that only surface hosts read, so
	// a turn edge never touches the context every bubble receives (I376).
	// Seeded from the first render, so a host mounting with the panel reads
	// current values with no lag.
	const heldSurfaceId = queuePending?.detachedSurfaceId ?? null;
	const turnStoreRef = useRef<A2uiTurnStore | null>(null);
	if (turnStoreRef.current === null) {
		turnStoreRef.current = createA2uiTurnStore({
			isSending,
			isQueued,
			isRestoringSession,
			sessionState,
			heldSurfaceId,
		});
	}
	const turnStore = turnStoreRef.current;
	// Layout effect: subscribed hosts re-render in the same commit flush,
	// before paint. publish() is a no-op when nothing changed.
	useLayoutEffect(() => {
		turnStore.publish({
			isSending,
			isQueued,
			isRestoringSession,
			sessionState,
			heldSurfaceId,
		});
	}, [turnStore, isSending, isQueued, isRestoringSession, sessionState, heldSurfaceId]);

	return { context, turnStore };
}

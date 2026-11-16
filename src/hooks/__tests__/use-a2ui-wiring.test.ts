/**
 * I376: useA2uiWiring's identity contract.
 *
 * - The a2ui context every message bubble receives keeps its identity across
 *   every turn-state change (sending, queued, held, session state, history
 *   load). Only a surface being defined or answered may change it.
 * - Turn state goes to the per-panel store instead, which notifies once per
 *   real change and never on an equal re-publish.
 * - onActivate reads its inputs at click time: the send uses the latest
 *   send function and the refocus uses the latest refocus callback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

vi.mock("obsidian", () => ({
	Notice: vi.fn(),
	Platform: { isMacOS: true },
}));

import { useA2uiWiring, type UseA2uiWiringInput } from "../useA2uiWiring";
import { validateA2uiFence } from "../../services/a2ui/validator";
import type { ChatMessage, QueuedMessage } from "../../types/chat";
import type { A2uiButton } from "../../services/a2ui/action";

afterEach(cleanup);

const ENVELOPE = JSON.stringify({
	version: "v1.0",
	createSurface: {
		surfaceId: "pick-1",
		catalogId: "https://agentconsole.dev/a2ui/catalogs/buttons-v0",
		components: [
			{ id: "root", component: "Row", children: ["b"] },
			{ id: "l", component: "Text", text: "Go" },
			{
				id: "b",
				component: "Button",
				child: "l",
				action: { event: { name: "go", context: {} } },
			},
		],
	},
});

const MESSAGES: ChatMessage[] = [
	{ id: "u0", role: "user", content: [{ type: "text", text: "hi" }] },
	{
		id: "a1",
		role: "assistant",
		content: [{ type: "text", text: "```a2ui\n" + ENVELOPE + "\n```" }],
	},
] as ChatMessage[];

function makeInput(): UseA2uiWiringInput {
	return {
		messages: MESSAGES,
		isSending: false,
		isQueued: false,
		queuePending: null,
		sessionState: "ready",
		isRestoringSession: false,
		queueDispatch: vi.fn(),
		lazyStateRef: { current: "ready" },
		isSendingRef: { current: false },
		isQueuedRef: { current: false },
		sessionHistoryLoadingRef: { current: false },
		handleSendMessageRef: { current: vi.fn(async () => {}) },
		refocusComposer: vi.fn(),
	};
}

describe("useA2uiWiring — context identity across turn edges (I376)", () => {
	it("keeps the bubble context identity when any turn field changes", () => {
		const base = makeInput();
		const { result, rerender } = renderHook((p: UseA2uiWiringInput) => useA2uiWiring(p), {
			initialProps: base,
		});
		const first = result.current.context;
		const held: QueuedMessage = { content: "x", detachedSurfaceId: "pick-1" };
		const steps: Partial<UseA2uiWiringInput>[] = [
			{ isSending: true },
			{ isSending: false },
			{ isQueued: true },
			{ isQueued: true, queuePending: held },
			{ isQueued: false, queuePending: null },
			{ sessionState: "busy" },
			{ sessionState: "permission" },
			{ sessionState: "released" },
			{ sessionState: "ready", isRestoringSession: true },
			{ isRestoringSession: false },
		];
		let props: UseA2uiWiringInput = base;
		for (const step of steps) {
			props = { ...props, ...step };
			rerender(props);
			expect(result.current.context).toBe(first);
		}
	});

	it("publishes turn state to the store, notifying once per real change", () => {
		const base = makeInput();
		const { result, rerender } = renderHook((p: UseA2uiWiringInput) => useA2uiWiring(p), {
			initialProps: base,
		});
		const store = result.current.turnStore;
		const listener = vi.fn();
		store.subscribe(listener);

		rerender({ ...base, isSending: true });
		expect(store.getSnapshot().isSending).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);

		// Equal re-publish (an unrelated re-render): no notify, same snapshot.
		const snap = store.getSnapshot();
		rerender({ ...base, isSending: true });
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot()).toBe(snap);

		rerender({
			...base,
			isSending: true,
			queuePending: { content: "x", detachedSurfaceId: "pick-1" },
		});
		expect(store.getSnapshot().heldSurfaceId).toBe("pick-1");
		expect(listener).toHaveBeenCalledTimes(2);
		// The store's identity is stable for the panel's life.
		expect(result.current.turnStore).toBe(store);
	});

	it("onActivate sends through the latest send function and refocuses through the latest callback", async () => {
		const input = makeInput();
		const { result, rerender } = renderHook((p: UseA2uiWiringInput) => useA2uiWiring(p), {
			initialProps: input,
		});
		const firstContext = result.current.context;
		const validation = validateA2uiFence(ENVELOPE);
		if (validation.kind !== "valid") throw new Error("fixture invalid");
		const surface = validation.surface;
		const button = surface.components.get("b") as unknown as A2uiButton;

		// The send function is swapped after the context was built: the click
		// must use the new one (refs are read at click time).
		const latest = vi.fn(async () => {});
		(input.handleSendMessageRef as { current: unknown }).current = latest;

		// A new refocus callback each render must not change the context.
		const latestRefocus = vi.fn();
		rerender({ ...input, refocusComposer: latestRefocus });
		expect(result.current.context).toBe(firstContext);

		const outcome = await result.current.context.onActivate(surface, button);
		expect(outcome).toBe("sent");
		expect(latest).toHaveBeenCalledTimes(1);
		// activateA2uiButton refocuses at dispatch.
		expect(latestRefocus).toHaveBeenCalledTimes(1);
		expect(input.refocusComposer).not.toHaveBeenCalled();
	});
});

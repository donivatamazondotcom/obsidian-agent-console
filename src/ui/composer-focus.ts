import type { ComposerAction } from "../resolvers/composer-focus";

/**
 * Focus helper for the composer textarea.
 *
 * Extracted from InputArea's mount auto-focus effect so the caret-placement
 * behaviour is unit-testable without mounting the full InputArea (which has
 * ~40 props and heavy plugin/AcpClient/view dependencies).
 *
 * Places the caret at the END of the textarea's current value. A textarea
 * focused with a pre-filled value (a restored unsent draft, #94) otherwise
 * defaults its caret to index 0, leaving the user at the START of their draft
 * (TP-I03). For an empty composer, end === 0, so behaviour is unchanged.
 */
export function focusComposerAtEnd(el: HTMLTextAreaElement | null): void {
	if (!el) return;
	el.focus();
	const end = el.value.length;
	el.setSelectionRange(end, end);
}


/** CSS selector for a chat composer textarea. */
const COMPOSER_SELECTOR = "textarea.agent-client-chat-input-textarea";

/**
 * Focus the composer for the ACTIVE tab within a chat view container, caret at
 * end.
 *
 * Why this exists (I136): the view-activate / Open-chat path focused the
 * composer with `containerEl.querySelector(COMPOSER_SELECTOR)`, which returns
 * the FIRST match in the DOM. Tabs are kept mounted with inactive ones hidden
 * via an inline `display:none` on the per-tab wrapper (I19), so first-match
 * focuses a BACKGROUND tab's composer and the user is never dropped into the
 * active composer. This selects the composer with no `display:none` ancestor
 * (the active tab), falling back to the first match when none is clearly
 * visible (e.g. a single freshly-mounted tab), then reuses focusComposerAtEnd.
 */
export function focusActiveTabComposer(container: HTMLElement): void {
	const composers = Array.from(
		container.querySelectorAll<HTMLTextAreaElement>(COMPOSER_SELECTOR),
	);
	const active =
		composers.find((el) => !isHiddenByDisplay(el)) ?? composers[0] ?? null;
	focusComposerAtEnd(active);
}

/**
 * Return focus to the active tab's composer on the next animation frame, caret
 * at end. Used by Send-type actions that run while DOM focus is on a control
 * outside the composer — e.g. firing a quick-prompt chip (focus on the chip
 * button) or a picker mouse-pick. The rAF defers past React's state flush so
 * the (freshly cleared / seeded) textarea is focused after it re-renders,
 * mirroring the quick-prompt bridge's insertAtCursor refocus.
 *
 * Unconditional by design: Send-type actions own their focus (the
 * composer-focus-return cluster guard deliberately excludes them), so this does
 * NOT consult `composerHadFocus`. No-ops when the container is absent.
 */
export function scheduleComposerRefocus(container: HTMLElement | null): void {
	if (!container) return;
	window.requestAnimationFrame(() => focusActiveTabComposer(container));
}

/** True when the element or any ancestor is hidden via an inline display:none. */
function isHiddenByDisplay(el: HTMLElement): boolean {
	let node: HTMLElement | null = el;
	while (node) {
		if (node.style?.display === "none") return true;
		node = node.parentElement;
	}
	return false;
}

/**
 * Dispatch a send and return focus to the composer.
 *
 * The single seam ChatPanel's Send wrapper routes through, so the send →
 * refocus TIMING has a testable home (I173). Send is composer-terminal: the
 * user types the next message immediately, so focus must return as soon as the
 * send is dispatched — NOT after the assistant's turn ends.
 *
 * Why this matters: `dispatchSend` chains through `agent.sendMessage` → the ACP
 * `session/prompt` RPC, which resolves only at turn-end. Awaiting it before
 * refocusing left the composer unfocused for the entire streamed response
 * (I173). See [[Composer Focus Return After State Change]] / [[I173 …]].
 */
export function sendAndReturnFocus(
	dispatchSend: () => Promise<void>,
	focusAfter: (action: ComposerAction) => void,
): void {
	// Fire the send; do NOT await it. `agent.sendMessage` resolves only at
	// turn-end (the ACP session/prompt RPC), so awaiting here delayed the
	// refocus until the whole streamed response finished (I173). Errors are
	// owned by handleSendMessage's internal try/catch, so `void` is safe.
	void dispatchSend();
	// Composer-terminal: refocus now (rAF-deferred inside focusAfter) and let
	// the turn stream in the background.
	focusAfter("send");
}

/**
 * One-shot hold on the composer refocus that runs when a tab becomes active
 * (InputArea's I19 effect). Set by the vertical tab rail just before Delete or
 * Backspace closes the focused ACTIVE key (I301): closing it activates the
 * neighbor, whose composer would otherwise take focus a tick later, so focus
 * would leave the rail and a second Backspace would edit the next chat's draft.
 *
 * Per document, so a popout window's rail and composers pair up. Consumed by
 * the very next activation refocus in that document, which the close always
 * triggers (closing the active tab with a neighbor activates it in the same
 * update), so a hold never outlives the close that set it. Every other
 * activation (mouse switch, × click, commands) refocuses the composer as before.
 */
const activationRefocusHolds = new WeakSet<Document>();

export function holdNextActivationRefocus(doc: Document): void {
	activationRefocusHolds.add(doc);
}

/** True (and clears the hold) when the next activation refocus must be skipped. */
export function takeActivationRefocusHold(doc: Document): boolean {
	return activationRefocusHolds.delete(doc);
}

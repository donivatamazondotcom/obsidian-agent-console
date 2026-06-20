/**
 * Pure decision logic for the command-palette rationalization (v1.2.0).
 *
 * Extracted from Plugin so the start-a-chat and context-gating decisions are
 * unit-testable without an Obsidian Plugin harness (the test stub has no
 * Plugin/addCommand seam). See [[Agent Console Command Palette Rationalization]].
 */

/**
 * What `Plugin.startChat()` should do, given whether any chat view is open and
 * an optional requested agent. Browser-tab model: "New chat" / "New chat with
 * agent…" open a new tab when a panel exists, or open a panel when none does.
 *
 * The decision is keyed on chat-view *existence*, not focus — this avoids the
 * I82-era ambiguity where a null focus target was conflated with "no panel"
 * and spawned a duplicate tab. Either branch always produces a visible chat;
 * no start-a-chat command can silently no-op.
 */
export type StartChatAction =
	| { kind: "open-panel"; agentId?: string }
	| { kind: "add-tab"; agentId?: string };

export function computeStartChat(
	hasChatView: boolean,
	agentId?: string,
): StartChatAction {
	return hasChatView
		? { kind: "add-tab", agentId }
		: { kind: "open-panel", agentId };
}

/**
 * Whether the navigate / act-on-chat / broadcast commands should be available
 * in the palette (and executable). They require at least one open chat view;
 * a cold-start palette surfaces only Open chat / New chat / New chat with
 * agent…. This is the predicate behind every gated command's `checkCallback`.
 */
export function isChatCommandAvailable(openChatViewCount: number): boolean {
	return openChatViewCount > 0;
}

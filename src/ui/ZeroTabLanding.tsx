/**
 * ZeroTabLanding — neutral resting screen shown when every tab is closed.
 *
 * Part of "Close Last Tab to Empty State" ([[Agent Console Close Last Tab to
 * Empty State]]). Closing the last tab lands here instead of being blocked.
 * Mirrors a browser's new-tab page: the workspace is never a dead end.
 *
 * Slice 3: the landing carries a LIVE launcher composer plus the quick-prompt
 * bar and explicit actions. Typing a prompt and sending — or firing a quick
 * prompt — launches a NEW session (a fresh tab on the default agent, message
 * sent). The composer is intentionally a minimal launcher, NOT the full in-tab
 * composer (which is session-coupled): its only job is to start a chat, after
 * which the spawned tab owns the real, full-featured composer. The composer
 * starts blank (locked design call — no predecessor tab to inherit from).
 *
 * The no-agent-detected face (install rows) is handled by the spawned tab's
 * first-run panel for now; a landing-level detection split is future work.
 * "Open session history" arrives in Slice 4.
 */

import * as React from "react";
const { useState, useCallback } = React;
import { QuickPromptBar } from "./QuickPromptBar";
import type { QuickPrompt } from "../types/quick-prompt";

export interface ZeroTabLandingProps {
	/**
	 * Launch a new chat from the composer: spawns a tab on the default agent
	 * and sends `text`. Wired by ChatView to the shared new-tab-and-send path.
	 */
	onSubmitPrompt: (text: string) => void;
	/** Quick prompts matched to the active note (may be empty → no chip row). */
	quickPrompts: QuickPrompt[];
	/** Fire a quick prompt: spawns a tab on the default agent and runs it. */
	onFireQuickPrompt: (prompt: QuickPrompt) => void;
	/** Start a new chat with the default agent (mirrors the tab bar's "+"). */
	onNewChat: () => void;
	/** Open the agent picker to start a new chat with a specific agent. */
	onNewChatWithAgent: (e: React.MouseEvent) => void;
	/** Open the session-history modal (Local source) to reopen a past session. */
	onOpenHistory: () => void;
}

export function ZeroTabLanding({
	onSubmitPrompt,
	quickPrompts,
	onFireQuickPrompt,
	onNewChat,
	onNewChatWithAgent,
	onOpenHistory,
}: ZeroTabLandingProps) {
	const [text, setText] = useState("");

	const submit = useCallback(() => {
		const trimmed = text.trim();
		if (trimmed === "") return;
		onSubmitPrompt(text);
		setText("");
	}, [text, onSubmitPrompt]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Enter sends; Shift+Enter inserts a newline. Ignore IME composition.
			if (
				e.key === "Enter" &&
				!e.shiftKey &&
				!e.nativeEvent.isComposing
			) {
				e.preventDefault();
				submit();
			}
		},
		[submit],
	);

	return (
		<div className="agent-client-zero-tab-landing">
			<div className="agent-client-zero-tab-landing-inner">
				<p className="agent-client-zero-tab-landing-message">
					Type a prompt to start a new chat.
				</p>
				<div className="agent-client-zero-tab-landing-composer">
					<textarea
						className="agent-client-zero-tab-landing-input"
						value={text}
						placeholder="Send a message to start a new chat…"
						aria-label="Start a new chat"
						rows={3}
						autoFocus
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					<button
						type="button"
						className="mod-cta agent-client-zero-tab-landing-send"
						disabled={text.trim() === ""}
						onClick={submit}
					>
						Send
					</button>
				</div>
				<QuickPromptBar
					prompts={quickPrompts}
					hasPendingQueue={false}
					onFire={(prompt) => onFireQuickPrompt(prompt)}
				/>
				<div className="agent-client-zero-tab-landing-actions">
					<button
						type="button"
						className="agent-client-zero-tab-landing-action"
						onClick={onNewChat}
					>
						New chat
					</button>
					<button
						type="button"
						className="agent-client-zero-tab-landing-action"
						onClick={onNewChatWithAgent}
					>
						New chat with an agent
					</button>
					<button
						type="button"
						className="agent-client-zero-tab-landing-action"
						onClick={onOpenHistory}
					>
						Open session history
					</button>
				</div>
			</div>
		</div>
	);
}

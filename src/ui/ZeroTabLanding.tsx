/**
 * ZeroTabLanding — neutral resting screen shown when every tab is closed AND at
 * least one agent is detected (the no-agent case renders the shared
 * GettingStarted shell instead; ChatView gates on detection).
 *
 * Part of "Close Last Tab to Empty State" ([[Agent Console Close Last Tab to
 * Empty State]]). Mirrors a browser new-tab page: the workspace is never a dead
 * end. Per the § UX review, this reuses the REAL composer (`InputArea`) as the
 * launcher — same inline send, `@`-mentions, and `!` quick prompts as a live
 * tab — rather than a bespoke composer. Typing + send (or firing a quick
 * prompt) launches a NEW session: a fresh tab on the default agent, message
 * sent (via `onLaunch` → ChatView's new-tab-and-send path).
 *
 * The composer stays docked at the bottom (its usual position); the center
 * holds only a secondary "Open session history" affordance — the redundant
 * New chat / New-chat-with-an-agent buttons were dropped (§ UX review: an empty
 * New chat is just the composer un-typed; agent choice is folded into the
 * default-agent launch + the agent-picker command).
 *
 * Session-only `InputArea` inputs are inert here: no live session (`lazyState:
 * "idle"`), empty slash commands, no messages/modes/models/queue/steer, images
 * off. `@`-mention *context carryover* into the spawned tab is a follow-up;
 * auto-mention is off so the composer doesn't imply context it won't carry yet.
 */

import * as React from "react";
const { useState, useCallback } = React;
import { InputArea } from "./InputArea";
import { useSuggestions } from "../hooks/useSuggestions";
import { resolvePromptText } from "../services/quick-prompts-logic";
import { deriveComposerAffordances } from "../resolvers/composer-affordances";
import type { QuickPrompt } from "../types/quick-prompt";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import type { SlashCommand } from "../types/session";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import type { VaultService } from "../services/vault-service";

const NO_COMMANDS: SlashCommand[] = [];

export interface ZeroTabLandingProps {
	plugin: AgentClientPlugin;
	/** View host (for InputArea event registration). */
	view: IChatViewHost;
	/** Vault access for @-mention search inside the composer. */
	vaultService: VaultService;
	/** Display name of the default agent (composer placeholder / launch target). */
	agentLabel: string;
	/** Default agent id — the agent a launched chat opens on (Decision 4). */
	agentId: string;
	/** Quick prompts matched to the active note (InputArea's chip bar + `!`). */
	quickPrompts: QuickPrompt[];
	/** Launch a new chat: spawn a tab on the default agent and send `text`. */
	onLaunch: (text: string) => void;
	/** Open the session-history modal (Local source) to reopen a past session. */
	onOpenHistory: () => void;
	/** Open the agent picker to start a new chat with a chosen agent (fresh tab). */
	onNewChatWithAgent: (e: React.MouseEvent) => void;
	/** Whether to show the picker at all (deriveAgentPickerOptions.show — >1 choice). */
	showAgentPicker: boolean;
}

export function ZeroTabLanding({
	plugin,
	view,
	vaultService,
	agentLabel,
	agentId,
	quickPrompts,
	onLaunch,
	onOpenHistory,
	onNewChatWithAgent,
	showAgentPicker,
}: ZeroTabLandingProps) {
	const [inputValue, setInputValue] = useState("");

	// The landing composer's behavior is resolved ONCE by the shared composer
	// resolver so the landing and in-tab composers cannot drift. On the landing
	// the send TARGET is a new-tab launch (sendMode:"launch"); that resolved
	// `launches` flag is what makes Enter dispatch instead of dead-queueing
	// (I169). Attachments/selectors resolve off here (no live session yet);
	// context-carry is a follow-up.
	const composerAffordances = deriveComposerAffordances({
		surface: "landing",
		capabilities: { supportsImages: false, hasConfigSelectors: false },
		hasQuickPrompts: quickPrompts.length > 0,
	});

	// Auto-mention OFF on the landing: there's no session to carry the mention
	// context into yet (carryover is a follow-up), so we don't imply context
	// the launch won't preserve. `@` search still works; slash commands are
	// empty (no connected agent).
	const suggestions = useSuggestions(
		vaultService,
		plugin,
		NO_COMMANDS,
		false,
		plugin.quickPromptLibrary,
	);

	const launch = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (trimmed === "") return;
			onLaunch(text);
			setInputValue("");
		},
		[onLaunch],
	);

	return (
		<div className="agent-client-zero-tab-landing">
			<div className="agent-client-zero-tab-landing-center">
				<div className="agent-client-zero-tab-landing-content">
					<p className="agent-client-zero-tab-landing-message">
						No chat open. Type below to start a new one.
					</p>
					<div className="agent-client-zero-tab-landing-actions">
						{showAgentPicker && (
							<button
								type="button"
								className="agent-client-zero-tab-landing-action"
								onClick={onNewChatWithAgent}
							>
								New chat with an agent
							</button>
						)}
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
			<InputArea
				isSending={false}
				isSessionReady={false}
				lazyState="idle"
				launches={composerAffordances.sendMode === "launch"}
				isRestoringSession={false}
				agentLabel={agentLabel}
				availableCommands={NO_COMMANDS}
				restoredMessage={null}
				suggestions={suggestions}
				plugin={plugin}
				view={view}
				onSendMessage={async (content) => {
					launch(content);
				}}
				onStopGeneration={async () => {}}
				onRestoredMessageConsumed={() => {}}
				supportsImages={false}
				imageCapabilityKnown={true}
				agentId={agentId}
				inputValue={inputValue}
				onInputChange={setInputValue}
				attachedFiles={[]}
				onAttachedFilesChange={() => {}}
				errorInfo={null}
				onClearError={() => {}}
				agentUpdateNotification={null}
				onClearAgentUpdate={() => {}}
				messages={[]}
				isActive={true}
				quickPromptPrompts={quickPrompts}
				quickPromptHasPendingQueue={false}
				hasQuickPrompts={quickPrompts.length > 0}
				onRunQuickPrompt={(prompt: QuickPrompt, _gesture: QuickPromptGesture) => {
					// On the landing every fire is a launch (no current session);
					// gesture collapses to spawn-a-tab-and-send the resolved text.
					launch(resolvePromptText(prompt.body, null));
				}}
			/>
		</div>
	);
}

/**
 * ZeroTabLanding — neutral resting screen shown when every tab is closed AND at
 * least one agent is detected (the no-agent case renders the shared
 * GettingStarted shell instead; ChatView gates on detection).
 *
 * Part of "Close Last Tab to Empty State" ([[Agent Console Close Last Tab to
 * Empty State]]). Mirrors a browser new-tab page: the workspace is never a dead
 * end. Per the § UX review, this reuses the REAL composer (`InputArea`) as the
 * launcher — same inline send, `@`-mentions, and `!` quick prompts as a live
 * tab. Typing + send (or firing a quick prompt) launches a NEW session: a fresh
 * tab on the default agent, message sent (via `onLaunch` → ChatView's
 * new-tab-and-send path).
 *
 * The composer's behavior is resolved ONCE by the shared `deriveComposerAffordances`
 * resolver (surface:"landing") so the landing and in-tab composers cannot drift.
 *
 * Context carry (`context:"carry"`): the landing reuses the REAL `ContextStrip`
 * so the user can pin the active note (grab / the dashed provisional pill) before
 * launching; those pinned notes are carried into the spawned tab as first-message
 * context via ChatView's `pendingPromptByTab` payload → the tab's existing
 * `restoredContextNotes` seeding path. `@`-mentioned notes carry for free as
 * `[[wikilink]]` text in the prompt — the spawned tab's send path crystallizes
 * them (`useChatActions` → `extractMentionedPaths`), so only explicit pins need
 * the payload carry. Session-only `InputArea` inputs remain inert (no live
 * session yet): `lazyState:"idle"`, empty slash commands, no modes/models/queue,
 * images off.
 */

import * as React from "react";
const { useState, useCallback, useRef } = React;
import { InputArea } from "./InputArea";
import { ContextStrip } from "./ContextStrip";
import { useSuggestions } from "../hooks/useSuggestions";
import { useContextNotes } from "../hooks/useContextNotes";
import { useSelectionTracker } from "../hooks/useSelectionTracker";
import { useSettings } from "../hooks/useSettings";
import { usePillOpenScope } from "./use-pill-open-scope";
import { computeProvisionalPath } from "../utils/provisional-context";
import { deriveNewLeaf, shouldOpenFromActivation } from "../utils/link-leaf";
import { focusComposerAtEnd } from "./composer-focus";
import { resolvePromptText } from "../services/quick-prompts-logic";
import { deriveComposerAffordances } from "../resolvers/composer-affordances";
import type { QuickPrompt } from "../types/quick-prompt";
import type { QuickPromptGesture } from "../services/quick-prompts-logic";
import type { SlashCommand } from "../types/session";
import type { ContextNote, ContextNoteSource } from "../types/context";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import type { VaultService } from "../services/vault-service";
import { t } from "../i18n";

const NO_COMMANDS: SlashCommand[] = [];

export interface ZeroTabLandingProps {
	plugin: AgentClientPlugin;
	/** View host (for InputArea event registration + pill-open keymap scope). */
	view: IChatViewHost;
	/** Vault access for @-mention search + active-note tracking. */
	vaultService: VaultService;
	/** Display name of the default agent (composer placeholder / launch target). */
	agentLabel: string;
	/** Default agent id — the agent a launched chat opens on (Decision 4). */
	agentId: string;
	/** Quick prompts matched to the active note (InputArea's chip bar + `!`). */
	quickPrompts: QuickPrompt[];
	/**
	 * Launch a new chat: spawn a tab on the default agent, send `text`, and
	 * carry `contextNotes` (the pinned notes) into it as first-message context.
	 */
	onLaunch: (text: string, contextNotes: ContextNote[]) => void;
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
	const composerElRef = useRef<HTMLTextAreaElement | null>(null);

	// The landing composer's behavior is resolved ONCE by the shared composer
	// resolver so the landing and in-tab composers cannot drift. On the landing
	// the send TARGET is a new-tab launch (sendMode:"launch"); that resolved
	// `launches` flag is what makes Enter dispatch instead of dead-queueing
	// (I169). Attachments/selectors resolve off here (no live session yet);
	// context is carried via the context strip below.
	const composerAffordances = deriveComposerAffordances({
		surface: "landing",
		capabilities: { supportsImages: false, hasConfigSelectors: false },
		hasQuickPrompts: quickPrompts.length > 0,
	});

	// Context carry: the landing reuses the real ContextStrip so the user can
	// pin the active note (or its provisional auto-default) before launching.
	// These are session-independent hooks — no live session required.
	const contextNotes = useContextNotes();
	const selectionTracker = useSelectionTracker(vaultService);
	const settings = useSettings(plugin);
	const [autoDefaultSuppressed, setAutoDefaultSuppressed] = useState(false);

	// Auto-mention OFF on the landing: the active-note auto-mention *badge* is a
	// separate affordance from context carry; `@` search still works and its
	// wikilinks carry as text. Slash commands are empty (no connected agent).
	const suggestions = useSuggestions(
		vaultService,
		plugin,
		NO_COMMANDS,
		false,
		plugin.quickPromptLibrary,
	);

	// Open a pinned context note in a pane, honoring click/Enter + ⌘/⌥/⌃/⇧ pane
	// modifiers — the same sanctioned `Keymap.isModEvent` path as the in-tab
	// strip. No session needed: a plain workspace link open.
	const openContextNote = useCallback(
		(path: string, native: MouseEvent | KeyboardEvent) => {
			if (!shouldOpenFromActivation(native)) return;
			void plugin.app.workspace.openLinkText(
				path,
				plugin.app.workspace.getActiveFile()?.path ?? "",
				deriveNewLeaf(native),
			);
		},
		[plugin.app.workspace],
	);
	// The landing is the only mounted surface at zero tabs, so it is always the
	// active pill-open scope holder.
	usePillOpenScope(plugin, view, true, openContextNote);

	const focusComposer = useCallback(() => {
		focusComposerAtEnd(composerElRef.current);
	}, []);

	const launch = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (trimmed === "") return;
			// Carry the pinned notes into the spawned tab (context:"carry").
			onLaunch(text, contextNotes.notes);
			setInputValue("");
		},
		[onLaunch, contextNotes.notes],
	);

	const provisionalPath = computeProvisionalPath({
		settingOn: settings.activeNoteAsDefaultContext,
		suppressed: autoDefaultSuppressed,
		messageCount: 0,
		activeNotePath: selectionTracker.activeNotePath,
		committed: contextNotes.notes,
	});

	return (
		<div className="agent-client-zero-tab-landing">
			<div className="agent-client-zero-tab-landing-center">
				<div className="agent-client-zero-tab-landing-content">
					<p className="agent-client-zero-tab-landing-message">
						{t("chat.landing.zeroTab")}
					</p>
					<div className="agent-client-zero-tab-landing-actions">
						{showAgentPicker && (
							<button
								type="button"
								className="agent-client-zero-tab-landing-action"
								onClick={onNewChatWithAgent}
							>
								{t("chat.landing.newChatWithAgent")}
							</button>
						)}
						<button
							type="button"
							className="agent-client-zero-tab-landing-action"
							onClick={onOpenHistory}
						>
							{t("chat.landing.openSessionHistory")}
						</button>
					</div>
				</div>
			</div>
			<ContextStrip
				notes={contextNotes.notes}
				isFull={contextNotes.isFull}
				activeNotePath={selectionTracker.activeNotePath}
				activeNoteName={selectionTracker.activeNoteName}
				onAdd={(path: string, source: ContextNoteSource) => {
					contextNotes.add(path, source);
					focusComposer();
				}}
				onRemove={(path: string) => {
					contextNotes.remove(path);
					focusComposer();
				}}
				onPillClick={(path, e) => openContextNote(path, e.nativeEvent)}
				onFocusComposer={focusComposer}
				provisionalPath={provisionalPath}
				onSuppressProvisional={() => {
					setAutoDefaultSuppressed(true);
					focusComposer();
				}}
			/>
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
				composerElRef={composerElRef}
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
					// gesture collapses to spawn-a-tab-and-send the resolved text,
					// carrying any pinned context notes.
					launch(resolvePromptText(prompt.body, null));
				}}
			/>
		</div>
	);
}

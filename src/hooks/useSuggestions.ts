import { useState, useCallback, useMemo, useEffect } from "react";
import type { NoteMetadata, IVaultAccess } from "../services/vault-service";
import type { MentionContext } from "../utils/mention-parser";
import type { SlashCommand } from "../types/session";
import type AgentClientPlugin from "../plugin";
import { prepareFuzzySearch } from "obsidian";
import type { CreatePromptRow } from "../services/quick-prompts-logic";
import type { QuickPrompt } from "../types/quick-prompt";
import type { QuickPromptLibrary } from "../services/quick-prompts";
import type { ResolvedPicker } from "../types/picker";
import { usePicker } from "./usePicker";
import {
	makeMentionSource,
	makeSlashSource,
	makeQuickPromptSource,
} from "../utils/picker-source-configs";

// ============================================================================
// Types
// ============================================================================

export interface MentionsState {
	/** Note suggestions matching the current mention query */
	suggestions: NoteMetadata[];
	/** Currently selected index in the dropdown */
	selectedIndex: number;
	/** Whether the dropdown is open */
	isOpen: boolean;
	/** Current mention context (query, position, etc.) */
	context: MentionContext | null;

	/** Update mention suggestions based on current input */
	updateSuggestions: (input: string, cursorPosition: number) => Promise<void>;
	/** Select a note from the dropdown. Returns updated input text */
	selectSuggestion: (input: string, suggestion: NoteMetadata) => string;
	/** Navigate the dropdown selection */
	navigate: (direction: "up" | "down") => void;
	/** Close the dropdown */
	close: () => void;
	/** Dismiss the dropdown and keep it closed for the current @ run (Esc) */
	dismiss: () => void;

	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;
	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled: boolean;
	/** Toggle auto-mention enabled/disabled state */
	toggleAutoMention: (disabled?: boolean) => void;
	/** Update the active note from the vault */
	updateActiveNote: () => Promise<void>;
}

export interface CommandsState {
	/** Filtered slash command suggestions */
	suggestions: SlashCommand[];
	/** Currently selected index in the dropdown */
	selectedIndex: number;
	/** Whether the dropdown is open */
	isOpen: boolean;

	/** Update slash command suggestions based on current input */
	updateSuggestions: (input: string, cursorPosition: number) => void;
	/** Select a slash command from the dropdown. Returns updated input text */
	selectSuggestion: (input: string, command: SlashCommand) => string;
	/** Navigate the dropdown selection */
	navigate: (direction: "up" | "down") => void;
	/** Close the dropdown */
	close: () => void;
}

export interface QuickPromptsState {
	/** Ranked quick-prompt suggestions for the current ! query */
	suggestions: QuickPrompt[];
	/** The "create" row to show when the ! query matches nothing (else null). */
	createRow: CreatePromptRow | null;
	/** Currently selected index in the dropdown */
	selectedIndex: number;
	/** Whether the dropdown is open */
	isOpen: boolean;

	/** Update suggestions from the composer text + caret (! trigger) */
	updateSuggestions: (input: string, cursorPosition: number) => void;
	/** Strip the ! token from the input on select; returns updated text */
	selectSuggestion: (input: string) => string;
	/** Navigate the dropdown selection */
	navigate: (direction: "up" | "down") => void;
	/** Close the dropdown */
	close: () => void;
}

// Backward-compatible type aliases
export type UseMentionsReturn = MentionsState;
export type UseSlashCommandsReturn = CommandsState;

export interface UseSuggestionsReturn {
	/** Mention dropdown state and operations */
	mentions: MentionsState;
	/** Slash command dropdown state and operations */
	commands: CommandsState;
	/** Quick-prompt (! trigger) dropdown state and operations */
	quickPrompts: QuickPromptsState;
	/**
	 * The single open picker, priority-resolved (quick-prompt > slash >
	 * mention), or null when none is open. `select` is bound by the consumer
	 * (InputArea), so this is the hook-owned {@link ResolvedPicker}. Tier 2.
	 */
	activePicker: ResolvedPicker | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing input suggestions (mentions + slash commands + quick
 * prompts).
 *
 * Tier 3 (Unified Picker Control): the three former hand-rolled state machines
 * are now three instances of one generic {@link usePicker} state machine, each
 * driven by a per-source {@link makeMentionSource} / {@link makeSlashSource} /
 * {@link makeQuickPromptSource} config. This hook is thin source wiring: it
 * builds the sources from live deps, runs a `usePicker` per source, and adapts
 * each into the existing `MentionsState` / `CommandsState` / `QuickPromptsState`
 * contract (so `InputArea` is unchanged). It also re-derives the Tier-2
 * priority-resolved {@link ResolvedPicker} the keyboard handler routes through.
 *
 * Auto-mention (active note + enable/disable toggle) is orthogonal to the
 * picker state machine and stays here as plain hook state.
 *
 * @param vaultAccess - Vault access for note searching
 * @param plugin - Plugin instance (reserved; kept for signature stability)
 * @param availableCommands - Available slash commands from the agent session
 * @param autoMentionDefault - Default auto-mention enabled state
 * @param quickPromptLibrary - Optional quick-prompt library (live ! set)
 */
export function useSuggestions(
	vaultAccess: IVaultAccess,
	plugin: AgentClientPlugin,
	availableCommands: SlashCommand[],
	autoMentionDefault: boolean,
	quickPromptLibrary?: QuickPromptLibrary,
): UseSuggestionsReturn {
	// ============================================================
	// Quick-prompt library (live ! set)
	// ============================================================
	// Subscribe so the ! picker filters the live set (read-only — firing is
	// owned by useQuickPrompts/ChatPanel).
	const [qpPrompts, setQpPrompts] = useState<QuickPrompt[]>(() =>
		quickPromptLibrary ? quickPromptLibrary.getPrompts() : [],
	);
	useEffect(() => {
		if (!quickPromptLibrary) return;
		setQpPrompts(quickPromptLibrary.getPrompts());
		return quickPromptLibrary.subscribe(() =>
			setQpPrompts(quickPromptLibrary.getPrompts()),
		);
	}, [quickPromptLibrary]);

	// ============================================================
	// Auto-mention toggle (orthogonal to the picker state machine)
	// ============================================================

	const [activeNote, setActiveNote] = useState<NoteMetadata | null>(null);
	const [isAutoMentionDisabled, setIsAutoMentionDisabled] = useState(
		!autoMentionDefault,
	);
	// Sync toggle when the setting changes at runtime (e.g. from plugin settings)
	useEffect(() => {
		setIsAutoMentionDisabled(!autoMentionDefault);
	}, [autoMentionDefault]);

	const toggleAutoMention = useCallback((disabled?: boolean) => {
		if (disabled === undefined) {
			setIsAutoMentionDisabled((prev) => !prev);
		} else {
			setIsAutoMentionDisabled(disabled);
		}
	}, []);

	const updateActiveNote = useCallback(async () => {
		const note = await vaultAccess.getActiveNote();
		setActiveNote(note);
	}, [vaultAccess]);

	// ============================================================
	// The three sources (all variance lives here) + one state machine each
	// ============================================================
	// Stable callbacks so the memoized source configs don't churn every render.
	const searchNotes = useCallback(
		(query: string) => vaultAccess.searchNotes(query),
		[vaultAccess],
	);
	// Obsidian's sanctioned fuzzy scorer, injected so the ! source stays pure.
	const makeScorer = useCallback(
		(query: string) => prepareFuzzySearch(query),
		[],
	);

	const mentionSource = useMemo(
		() => makeMentionSource(searchNotes),
		[searchNotes],
	);
	const slashSource = useMemo(
		() => makeSlashSource(availableCommands),
		[availableCommands],
	);
	const quickPromptSource = useMemo(
		() => makeQuickPromptSource(qpPrompts, makeScorer),
		[qpPrompts, makeScorer],
	);

	const mentionPicker = usePicker(mentionSource);
	const slashPicker = usePicker(slashSource);
	const quickPromptPicker = usePicker(quickPromptSource);

	// ============================================================
	// Active picker (Tier 2) — priority-resolve the single open source
	// ============================================================
	// quick-prompt > slash > mention; only one is ever open (the @ / / / !
	// triggers are mutually exclusive at the caret). `select` is bound by
	// InputArea (composer-side effects), so the hook exposes the ResolvedPicker.
	const activePicker = useMemo<ResolvedPicker | null>(() => {
		if (quickPromptPicker.isOpen) {
			return {
				kind: "quick-prompt",
				isOpen: true,
				items: quickPromptPicker.items.map((item) =>
					quickPromptSource.toPickerItem(item),
				),
				selectedIndex: quickPromptPicker.selectedIndex,
				navigate: quickPromptPicker.navigate,
				dismiss: quickPromptPicker.dismiss,
				capabilities: quickPromptSource.capabilities,
			};
		}
		if (slashPicker.isOpen) {
			return {
				kind: "slash",
				isOpen: true,
				items: slashPicker.items.map((item) =>
					slashSource.toPickerItem(item),
				),
				selectedIndex: slashPicker.selectedIndex,
				navigate: slashPicker.navigate,
				dismiss: slashPicker.dismiss,
				capabilities: slashSource.capabilities,
			};
		}
		if (mentionPicker.isOpen) {
			return {
				kind: "mention",
				isOpen: true,
				items: mentionPicker.items.map((item) =>
					mentionSource.toPickerItem(item),
				),
				selectedIndex: mentionPicker.selectedIndex,
				navigate: mentionPicker.navigate,
				// mention Escape keeps the run-dismiss guard (slash/! just close).
				dismiss: mentionPicker.dismiss,
				capabilities: mentionSource.capabilities,
			};
		}
		return null;
	}, [
		quickPromptPicker,
		quickPromptSource,
		slashPicker,
		slashSource,
		mentionPicker,
		mentionSource,
	]);

	// ============================================================
	// Adapt each picker into the existing exposed contract
	// ============================================================
	// InputArea/ChatPanel/useChatActions read these exact shapes — the adapters
	// keep them byte-identical while the state machine underneath is unified.

	const mentions = useMemo<MentionsState>(
		() => ({
			suggestions: mentionPicker.items,
			selectedIndex: mentionPicker.selectedIndex,
			isOpen: mentionPicker.isOpen,
			context: mentionPicker.context,
			// Async vault search → Promise<void> (InputArea voids it; tests await it).
			updateSuggestions: async (input, cursorPosition) => {
				await mentionPicker.updateSuggestions(input, cursorPosition);
			},
			selectSuggestion: (input, suggestion) =>
				mentionPicker.selectSuggestion(input, suggestion),
			navigate: mentionPicker.navigate,
			close: mentionPicker.close,
			dismiss: mentionPicker.dismiss,
			activeNote,
			isAutoMentionDisabled,
			toggleAutoMention,
			updateActiveNote,
		}),
		[
			mentionPicker,
			activeNote,
			isAutoMentionDisabled,
			toggleAutoMention,
			updateActiveNote,
		],
	);

	const commands = useMemo<CommandsState>(
		() => ({
			suggestions: slashPicker.items,
			selectedIndex: slashPicker.selectedIndex,
			isOpen: slashPicker.isOpen,
			// Sync filter → void (explicit `void` so no floating-promise lint).
			updateSuggestions: (input, cursorPosition) => {
				void slashPicker.updateSuggestions(input, cursorPosition);
			},
			selectSuggestion: (input, command) =>
				slashPicker.selectSuggestion(input, command),
			navigate: slashPicker.navigate,
			close: slashPicker.close,
		}),
		[slashPicker],
	);

	const quickPrompts = useMemo<QuickPromptsState>(
		() => ({
			suggestions: quickPromptPicker.items,
			// The ! source is the only one with a create row, and it always
			// returns a CreatePromptRow — narrow the hook's structural type.
			createRow: quickPromptPicker.createRow as CreatePromptRow | null,
			selectedIndex: quickPromptPicker.selectedIndex,
			isOpen: quickPromptPicker.isOpen,
			// Sync rank → void (explicit `void` so no floating-promise lint).
			updateSuggestions: (input, cursorPosition) => {
				void quickPromptPicker.updateSuggestions(input, cursorPosition);
			},
			selectSuggestion: (input) =>
				quickPromptPicker.selectSuggestion(input),
			navigate: quickPromptPicker.navigate,
			close: quickPromptPicker.close,
		}),
		[quickPromptPicker],
	);

	// ============================================================
	// Return
	// ============================================================

	return useMemo(
		() => ({ mentions, commands, quickPrompts, activePicker }),
		[mentions, commands, quickPrompts, activePicker],
	);
}

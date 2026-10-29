/**
 * Where a quick prompt fire lands, from its `agent:` / `mode:` / `newTab`
 * frontmatter. Pure — the single resolver every fire path reads (chips,
 * palette, hotkeys, and later `obsidian://` URIs), so they can never disagree.
 *
 * The rule: if a prompt needs a different agent or mode than the current tab,
 * it opens a new tab set up that way. Otherwise it fires in place. A tab never
 * changes agent or mode because of a prompt.
 *
 * Whether a requested mode exists is only known once the new tab's session is
 * up, so that check (`sessionModeInfo`) runs at the queue flush, not here.
 *
 * See [[Agent Console Quick Prompt Agent and Mode]].
 */

import {
	flattenConfigSelectOptions,
	type SessionConfigOption,
	type SessionModeState,
} from "../types/session";

export interface PromptTargetIntent {
	agent?: string;
	mode?: string;
	newTab?: boolean;
}

export interface PromptTargetContext {
	/** Agent id of the active tab, or null when no tab is open. */
	activeAgentId: string | null;
	/** Current mode id of the active tab's session, or null when unknown. */
	activeModeId: string | null;
	/** Agent ids configured in settings. */
	availableAgentIds: readonly string[];
}

export type PromptTarget =
	| { kind: "here" }
	/** `agentId` absent ⇒ the caller's default agent. */
	| { kind: "new-tab"; agentId?: string; modeId?: string }
	| { kind: "unknown-agent"; agentId: string };

function newTab(agentId?: string, modeId?: string): PromptTarget {
	return {
		kind: "new-tab",
		...(agentId ? { agentId } : {}),
		...(modeId ? { modeId } : {}),
	};
}

export function resolvePromptTarget(
	intent: PromptTargetIntent,
	ctx: PromptTargetContext,
): PromptTarget {
	const { agent, mode } = intent;

	// Exact id match only — a typo must fail loud, never guess an agent.
	if (agent !== undefined && !ctx.availableAgentIds.includes(agent)) {
		return { kind: "unknown-agent", agentId: agent };
	}

	// No tab open: everything lands in a new tab.
	if (ctx.activeAgentId === null) return newTab(agent, mode);

	// A different agent always means a new tab (overrides `newTab: false`).
	if (agent !== undefined && agent !== ctx.activeAgentId) {
		return newTab(agent, mode);
	}

	// A different (or unknowable) mode means a new tab. Mode ids belong to an
	// agent, so a mode-only prompt keeps the current tab's agent.
	if (mode !== undefined && mode !== ctx.activeModeId) {
		return newTab(agent ?? ctx.activeAgentId, mode);
	}

	// Agent and mode match (or are unset): the shipped `newTab` behavior,
	// which opens the default agent when no agent is declared.
	if (intent.newTab === true) return newTab(agent, mode);
	return { kind: "here" };
}

export interface SessionModeInfo {
	/** The session's current mode id, or null when the agent has no modes. */
	current: string | null;
	/** Every mode id the session offers. */
	offered: string[];
}

/**
 * Read a session's modes from whichever shape the agent uses. Config options
 * supersede the legacy `modes` API, matching `restoreConfigOptions`, which
 * locates the mode option by `category === "mode"`.
 */
export function sessionModeInfo(session: {
	modes?: SessionModeState;
	configOptions?: SessionConfigOption[];
}): SessionModeInfo {
	const option = session.configOptions?.find((o) => o.category === "mode");
	if (option) {
		return {
			current: option.currentValue,
			offered: flattenConfigSelectOptions(option.options).map(
				(o) => o.value,
			),
		};
	}
	if (session.modes) {
		return {
			current: session.modes.currentModeId || null,
			offered: session.modes.availableModes.map((m) => m.id),
		};
	}
	return { current: null, offered: [] };
}

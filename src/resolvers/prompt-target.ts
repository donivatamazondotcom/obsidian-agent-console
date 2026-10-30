/**
 * Where a quick prompt fire lands, from its `agent:` / `mode:` / `newTab`
 * frontmatter (pure, total). The single resolver every fire path reads
 * (chips, palette, hotkeys, and later `obsidian://` URIs), so they can never
 * disagree.
 *
 * The rule: if a prompt needs a different agent or mode than the current tab,
 * it opens a new tab set up that way. Otherwise it fires in place. A tab never
 * changes agent or mode because of a prompt.
 *
 * `agent:` and `mode:` accept an id or the display name the user sees
 * (`lookupByIdOrName`). A mode can only be resolved against a live session's
 * list: for the current tab's agent that happens here (so an unknown mode
 * fails before anything opens); for another agent the raw request travels to
 * the new tab and is resolved when its session starts.
 *
 * Spec: [[Agent Console Quick Prompt Agent and Mode]].
 */
import {
	lookupByIdOrName,
	type NamedItem,
	type SessionModes,
} from "./session-modes";

export interface PromptTargetIntent {
	agent?: string;
	mode?: string;
	newTab?: boolean;
}

export interface PromptTargetContext {
	/** Agent id of the active tab, or null when no tab is open. */
	activeAgentId: string | null;
	/** The active tab's session modes, or null when unknown / none. */
	activeModes: SessionModes | null;
	/** Configured agents: settings id + display name. */
	agents: readonly NamedItem[];
}

export type PromptTarget =
	| { kind: "here" }
	/**
	 * `agentId` absent ⇒ the caller's default agent. `modeId` is a resolved id
	 * when the target is the current agent, otherwise the raw request.
	 */
	| { kind: "new-tab"; agentId?: string; modeId?: string }
	| { kind: "unknown-agent"; agentId: string }
	| { kind: "unknown-mode"; agentId: string; modeId: string };

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
	let agentId: string | undefined;
	if (intent.agent !== undefined) {
		const found = lookupByIdOrName(intent.agent, ctx.agents);
		if (!found) return { kind: "unknown-agent", agentId: intent.agent };
		agentId = found;
	}
	const mode = intent.mode;

	// No tab open: everything lands in a new tab.
	if (ctx.activeAgentId === null) return newTab(agentId, mode);

	// A different agent always means a new tab (overrides `newTab: false`).
	// Its modes are unknown until its session starts, so the mode goes raw.
	if (agentId !== undefined && agentId !== ctx.activeAgentId) {
		return newTab(agentId, mode);
	}

	if (mode !== undefined) {
		// Mode ids belong to an agent, so a mode-only prompt keeps the current
		// tab's agent. Unknown current modes count as different.
		if (!ctx.activeModes) return newTab(agentId ?? ctx.activeAgentId, mode);
		const modeId = lookupByIdOrName(mode, ctx.activeModes.offered);
		if (!modeId) {
			return { kind: "unknown-mode", agentId: ctx.activeAgentId, modeId: mode };
		}
		if (modeId !== ctx.activeModes.current.id) {
			return newTab(agentId ?? ctx.activeAgentId, modeId);
		}
	}

	// Agent and mode match (or are unset): the shipped `newTab` behavior,
	// which opens the default agent when no agent is declared.
	if (intent.newTab === true) return newTab(agentId, mode);
	return { kind: "here" };
}

/**
 * Where and how a quick prompt fire lands, from its `agent:` / `mode:` /
 * `newTab` frontmatter. Pure — the single resolver every fire path reads
 * (chips, palette, hotkeys, and later `obsidian://` URIs), so they can never
 * disagree.
 *
 * Two stages, because the inputs arrive at different times:
 *
 * 1. `resolvePromptTarget` — at fire time, from settings: which tab and agent.
 * 2. `resolvePromptMode` — once the target session is up, from the modes that
 *    session advertises: whether a mode switch is needed before the send.
 *
 * See [[Agent Console Quick Prompt Agent and Mode]].
 */

export interface PromptTargetIntent {
	agent?: string;
	mode?: string;
	newTab?: boolean;
}

export interface PromptTargetContext {
	/** Agent id of the active tab, or null when no tab is open. */
	activeAgentId: string | null;
	/** Agent ids configured in settings. */
	availableAgentIds: readonly string[];
}

export type PromptTarget =
	| { kind: "here"; modeId?: string }
	/** `agentId` absent ⇒ the caller's default agent. */
	| { kind: "new-tab"; agentId?: string; modeId?: string }
	| { kind: "unknown-agent"; agentId: string };

function withMode<T extends object>(
	target: T,
	modeId: string | undefined,
): T & { modeId?: string } {
	return modeId ? { ...target, modeId } : target;
}

export function resolvePromptTarget(
	intent: PromptTargetIntent,
	ctx: PromptTargetContext,
): PromptTarget {
	const { agent, mode, newTab } = intent;

	if (agent !== undefined) {
		// Exact id match only — a typo must fail loud, never guess an agent.
		if (!ctx.availableAgentIds.includes(agent)) {
			return { kind: "unknown-agent", agentId: agent };
		}
		// A different agent always means a new tab: a tab never switches
		// agent because of a prompt (overrides an explicit `newTab: false`).
		if (agent !== ctx.activeAgentId) {
			return withMode({ kind: "new-tab" as const, agentId: agent }, mode);
		}
	}

	if (newTab === true || ctx.activeAgentId === null) {
		// No declared agent ⇒ no agentId: the caller opens its default agent,
		// exactly as `newTab` prompts did before agent/mode existed.
		return withMode(
			agent
				? { kind: "new-tab" as const, agentId: agent }
				: { kind: "new-tab" as const },
			mode,
		);
	}

	return withMode({ kind: "here" as const }, mode);
}

export type PromptModeAction =
	| { kind: "none" }
	| { kind: "switch"; modeId: string }
	| { kind: "unknown-mode"; modeId: string };

export function resolvePromptMode(
	requestedModeId: string | undefined,
	availableModes: readonly { id: string }[],
	currentModeId: string,
): PromptModeAction {
	if (!requestedModeId) return { kind: "none" };
	if (!availableModes.some((m) => m.id === requestedModeId)) {
		return { kind: "unknown-mode", modeId: requestedModeId };
	}
	if (requestedModeId === currentModeId) return { kind: "none" };
	return { kind: "switch", modeId: requestedModeId };
}

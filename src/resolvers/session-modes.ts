/**
 * Session modes + id-or-name lookup (pure, total).
 *
 * `readSessionModes` — a session's current mode and every mode on offer, from
 * whichever shape the agent uses. The `mode` config option (Kiro CLI V3)
 * supersedes the legacy `modes` state, per the ACP config-options spec. The
 * single reader for both the header (`header-agent`) and quick-prompt
 * targeting (`prompt-target`), so they can never disagree on what mode a
 * session is in.
 *
 * `lookupByIdOrName` — resolve what a user typed (a quick prompt's `agent:` /
 * `mode:`) to an id. Users copy the label they see and ids are hidden (Kiro's
 * built-in `vibe` shows as "Default"), so: exact id, then exact name, then a
 * UNIQUE case-insensitive name. Anything else is no match — never guess.
 *
 * Spec: [[Agent Console Quick Prompt Agent and Mode]] § Frontmatter.
 */
import {
	flattenConfigSelectOptions,
	type SessionConfigOption,
	type SessionModeState,
} from "../types/session";

export interface NamedItem {
	id: string;
	name: string;
}

export interface SessionModes {
	current: NamedItem;
	offered: NamedItem[];
}

export interface SessionModesInput {
	modes?: SessionModeState | null;
	configOptions?: SessionConfigOption[] | null;
}

/** Null when the session advertises no modes (or none yet — connecting). */
export function readSessionModes(input: SessionModesInput): SessionModes | null {
	const option = input.configOptions?.find(
		(o) => o.id === "mode" || o.category === "mode",
	);
	if (option) {
		const offered = flattenConfigSelectOptions(option.options).map((o) => ({
			id: o.value,
			name: o.name || o.value,
		}));
		return {
			current: offered.find((o) => o.id === option.currentValue) ?? {
				id: option.currentValue,
				name: option.currentValue,
			},
			offered,
		};
	}
	if (input.modes) {
		const offered = input.modes.availableModes.map((m) => ({
			id: m.id,
			name: m.name || m.id,
		}));
		const currentId = input.modes.currentModeId;
		return {
			current: offered.find((o) => o.id === currentId) ?? {
				id: currentId,
				name: currentId,
			},
			offered,
		};
	}
	return null;
}

export function lookupByIdOrName(
	requested: string,
	items: readonly NamedItem[],
): string | null {
	const byId = items.find((i) => i.id === requested);
	if (byId) return byId.id;
	const byName = items.filter((i) => i.name === requested);
	if (byName.length === 1) return byName[0].id;
	if (byName.length > 1) return null;
	const folded = requested.toLowerCase();
	const byFolded = items.filter((i) => i.name.toLowerCase() === folded);
	return byFolded.length === 1 ? byFolded[0].id : null;
}

// ============================================================================
// Quick prompt mode request (one-shot, first session of a tab)
// ============================================================================

/**
 * Resolve a quick prompt's requested mode (id or display name) against the
 * modes a brand-new session offers. Pure and total.
 *
 * - No request → nothing to do.
 * - Found → the mode id, to join the pre-ready re-apply.
 * - Not offered → `unmet`, so the tab can return the prompt unsent.
 * - No mode list yet on an agent that may deliver it late (Kiro CLI V3) →
 *   pass the request through raw; the late-update reconcile applies it if it
 *   matches an id. Not flagged unmet, because absence isn't evidence yet.
 *
 * Spec: [[Agent Console Quick Prompt Agent and Mode]].
 */
export function resolveModeRequest(
	request: string | undefined,
	input: SessionModesInput & { modeListMayArriveLate: boolean },
): { modeId?: string; unmet?: string } {
	if (!request) return {};
	const modes = readSessionModes(input);
	if (!modes) {
		return input.modeListMayArriveLate ? { modeId: request } : { unmet: request };
	}
	const modeId = lookupByIdOrName(request, modes.offered);
	return modeId ? { modeId } : { unmet: request };
}

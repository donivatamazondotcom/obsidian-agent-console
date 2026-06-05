import type { ContextNote } from "../types/context";
import { MAX_CONTEXT_NOTES } from "../types/context";

/**
 * Decision #26 (I68): the dashed provisional auto-default pill is shown only on
 * a fresh chat — no messages sent yet, setting on, not suppressed, active note
 * not already committed, and under the cap. Returns the path to show, or null.
 */
export function computeProvisionalPath(args: {
	settingOn: boolean;
	suppressed: boolean;
	messageCount: number;
	activeNotePath: string | null;
	committed: ContextNote[];
}): string | null {
	const { settingOn, suppressed, messageCount, activeNotePath, committed } =
		args;
	if (!settingOn || suppressed || messageCount > 0 || !activeNotePath) {
		return null;
	}
	if (committed.length >= MAX_CONTEXT_NOTES) return null;
	if (committed.some((n) => n.path === activeNotePath)) return null;
	return activeNotePath;
}

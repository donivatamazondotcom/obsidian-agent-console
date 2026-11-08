import type { KiroEngineFallback } from "../types/session";

/**
 * I302: whether the "update Kiro CLI to get V3" tip shows in a chat. Only a
 * tab whose Default engine fell back to V2 on an old kiro-cli shows it, and
 * only until the user dismisses it once for this install. Pure and total.
 */
export type KiroUpdateTip = { kind: "show" } | { kind: "hidden" };

export function deriveKiroUpdateTip(input: {
	fallback: KiroEngineFallback | undefined;
	dismissed: boolean;
}): KiroUpdateTip {
	return input.fallback === "old-cli" && !input.dismissed
		? { kind: "show" }
		: { kind: "hidden" };
}

/**
 * a2ui-surface-refusal — the surface-scoped half of the A2UI control
 * decision (I376).
 *
 * `deriveSurfaceActionAffordance` (services/a2ui/surface-state.ts) checks
 * these reasons first and reads tab state only when none applies. The
 * surface host calls this same function to decide whether it needs tab state
 * at all, so a host that can't be clicked never subscribes to the turn store
 * and a turn edge doesn't re-render it. One function, so the two can never
 * disagree.
 */

/** Per-surface submission status (runtime; reconstructed from transcript on restore). */
export type A2uiSurfaceStatus = "unanswered" | "pending" | "answered";

/** A refusal that comes from the surface itself, before any tab state. */
export type A2uiSurfaceScopedRefusal =
	| "answered"
	| "pending"
	| "superseded"
	| "streaming";

export interface A2uiSurfaceScopedInput {
	surfaceStatus: A2uiSurfaceStatus;
	/** A newer surface was defined after this one. */
	isSuperseded: boolean;
	/** The assistant turn containing this surface is still streaming. */
	isStreamingTurn: boolean;
}

export function deriveSurfaceScopedRefusal(
	input: A2uiSurfaceScopedInput,
): A2uiSurfaceScopedRefusal | null {
	switch (input.surfaceStatus) {
		case "answered":
			return "answered";
		case "pending":
			return "pending";
		case "unanswered":
			if (input.isSuperseded) return "superseded";
			if (input.isStreamingTurn) return "streaming";
			return null;
	}
}

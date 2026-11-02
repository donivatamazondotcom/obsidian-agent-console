/**
 * Normalizes an ACP `StopReason` into the app's `TurnStopKind`.
 *
 * Lives at the `acp/` edge (anti-corruption boundary) so the raw SDK strings
 * never reach hooks or UI. Total: an unrecognized or missing value maps to
 * `unknown` rather than throwing, because ACP may add stop reasons.
 * See [[Tab Attention States]].
 */
import type { TurnStopKind } from "../types/session";

export function toTurnStopKind(raw: unknown): TurnStopKind {
	switch (raw) {
		case "end_turn":
			return "endTurn";
		case "max_tokens":
			return "maxTokens";
		case "max_turn_requests":
			return "maxRequests";
		case "refusal":
			return "refusal";
		case "cancelled":
			return "cancelled";
		default:
			return "unknown";
	}
}

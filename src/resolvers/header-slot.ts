/**
 * `deriveHeaderSlot` — the single pure resolver for the header's secondary
 * slot in Agent Console.
 *
 * WHY THIS EXISTS
 * The secondary slot is a single four-way choice — show the model name, a
 * "Connecting…" placeholder, an idle ("Not connected") placeholder, or
 * nothing — but it used to be encoded in `ChatHeader.tsx` as three overlapping
 * inline booleans built from negated conditions:
 *
 *   const showModel = !!segments.model;
 *   const showConnectingPlaceholder =
 *       !segments.model && !segments.isLazyIdle && !!segments.isConnecting;
 *   const showIdlePlaceholder = !segments.model && !!segments.isLazyIdle;
 *
 * I80 (header stuck on "Connecting…" for agents that never report a model,
 * e.g. Claude Code) was fixed by *adding* the `isConnecting` term to the
 * expression rather than modeling the slot as one state; I40 (idle tab showing
 * "Connecting…") touches the same logic. Adding a term to a boolean to fix a
 * bug is the signal the decision was never centralized.
 *
 * DESIGN
 *  - A present model wins over every other flag: a connected session with a
 *    model name shows the model. This makes illegal combinations (e.g.
 *    "connecting" while a model is present) unrepresentable in the output
 *    rather than something the next reader has to re-derive correctly.
 *  - With no model, `isLazyIdle` (the tab has not attempted to connect) takes
 *    precedence over `isConnecting`, matching the prior
 *    `showIdlePlaceholder = !model && isLazyIdle` (idle regardless of the
 *    connecting flag) — this is the I40 guard.
 *  - With no model and not idle, `isConnecting` gates the "Connecting…"
 *    placeholder; absent it, the slot is empty (the I80 guard: a `ready`
 *    session that simply never reported a model shows nothing, not
 *    "Connecting…" forever).
 *
 * Pure — no React, no Obsidian. Safe to unit-test exhaustively (8 rows).
 */

export interface HeaderSlotInput {
	/**
	 * Active model display name (e.g. "claude-opus-4.7"); null while the
	 * session is connecting OR for agents that never report a model.
	 */
	model: string | null;
	/** The tab is in lazy-idle state (no connection attempted yet). */
	isLazyIdle: boolean;
	/**
	 * Session acquisition is genuinely in flight (lazySession.state ===
	 * "connecting"). Gates the "Connecting…" placeholder so a `ready` session
	 * that never reported a model does NOT render "Connecting…" forever (I80).
	 */
	isConnecting: boolean;
}

/**
 * The resolved secondary-slot state. Discriminated on `kind`; the `model`
 * variant carries the (non-null) model name so the renderer never re-checks.
 */
export type HeaderSlot =
	| { kind: "model"; model: string }
	| { kind: "connecting" }
	| { kind: "idle" }
	| { kind: "empty" };

/**
 * The single secondary-slot decision. See module doc for the precedence rules.
 */
export function deriveHeaderSlot(input: HeaderSlotInput): HeaderSlot {
	const { model, isLazyIdle, isConnecting } = input;

	// A present model wins over every flag — illegal combinations collapse here.
	if (model) {
		return { kind: "model", model };
	}
	// No model: idle takes precedence over connecting (I40 guard).
	if (isLazyIdle) {
		return { kind: "idle" };
	}
	// No model, not idle: genuine in-flight acquisition shows "Connecting…".
	if (isConnecting) {
		return { kind: "connecting" };
	}
	// No model, not idle, not connecting: nothing (I80 guard — ready, no model).
	return { kind: "empty" };
}

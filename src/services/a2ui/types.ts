/**
 * Domain types for the A2UI `buttons-v0` trust boundary.
 *
 * Everything downstream of the validator consumes these types — never raw
 * agent JSON. Tagged unions keep illegal combinations unrepresentable
 * (repo tenet: pure resolver / trust-boundary validation).
 *
 * See: vault spec "Agent Console Agent-Emitted Interactive Prompts" (D5, D6,
 * D10, D12) — the validator ports the feasibility probe's V01–V14 checks.
 */

/** A fenced ```a2ui block found in markdown text. */
export interface A2uiFenceCandidate {
	/** Fence body (the lines between the fence markers), without trailing newline. */
	body: string;
	/** Char offset of the opening fence marker's first character. */
	start: number;
	/**
	 * Char offset just past the closing fence line (or text end when unclosed).
	 * `[start, end)` spans the whole fence block for segmentation.
	 */
	end: number;
	/**
	 * False while the fence is still open at the end of the text (streaming
	 * partial). Unclosed fences stay inert code blocks — never validated.
	 */
	closed: boolean;
}

/** Violation codes, aligned with the probe's V01–V13 check list. */
export type A2uiViolationCode =
	| "not-single-line" // V02
	| "invalid-json" // V03
	| "bad-envelope" // V04 — not exactly one message key, or not createSurface
	| "bad-version" // V05 — neither v1.0 nor a tolerated version
	| "bad-surface-id" // V06 — pattern
	| "duplicate-surface-id" // V06 — uniqueness within session
	| "bad-catalog" // V07 — neither profile nor tolerated Basic id
	| "bad-components" // V08 — missing/not an array/empty
	| "missing-root" // V08 — no component with id "root"
	| "duplicate-component-id" // V08
	| "unknown-component-type" // V09
	| "dangling-ref" // V10
	| "cycle" // V10
	| "depth-exceeded" // V10
	| "bad-button" // V11 — child/label/action/event/context contract
	| "forbidden-key" // V12 — path/call/functionCall/checks/dataModel/…
	| "identity-field" // V12 — surfaceProperties agentDisplayName/iconUrl
	| "over-limit"; // V13 — component count / string size / fence size

export interface A2uiViolation {
	code: A2uiViolationCode;
	/** Human-readable specifics (offending key, id, count…). Never rendered to the agent. */
	detail: string;
}

/** A validated buttons-v0 component (literal values only). */
export type A2uiComponent =
	| { kind: "text"; id: string; text: string }
	| {
			kind: "container";
			id: string;
			component: "Row" | "Column" | "Card";
			children: string[];
	  }
	| { kind: "divider"; id: string }
	| {
			kind: "button";
			id: string;
			/** id of the Text component holding the label. */
			child: string;
			/** Resolved label text (from the child Text) for rendering + summaries. */
			label: string;
			event: A2uiButtonEvent;
	  };

export interface A2uiButtonEvent {
	name: string;
	/** Literal-only context per buttons-v0 (D6). */
	context: Record<string, string | number | boolean>;
}

/** A fully validated surface, safe to render. */
export interface A2uiValidatedSurface {
	surfaceId: string;
	catalogId: string;
	version: string;
	components: ReadonlyMap<string, A2uiComponent>;
	/** Always "root" — kept explicit for renderer clarity. */
	rootId: string;
	/**
	 * Tolerated-shape hits (Postel): v0.9.1 version or Basic Catalog id were
	 * accepted under the same profile subset. Recorded for diagnostics.
	 */
	tolerated: { version: boolean; catalog: boolean };
	/** V14 — components unreachable from root. Rendered surfaces skip them; warn only. */
	orphanIds: readonly string[];
}

/** Total, no-throw validation result (trust-boundary tenet: drop-and-log, never coerce). */
export type A2uiFenceValidation =
	| { kind: "valid"; surface: A2uiValidatedSurface }
	| { kind: "invalid"; violations: readonly A2uiViolation[] };

export interface A2uiValidateOptions {
	/** surfaceIds already seen in this session — duplicates render inert (first wins). */
	existingSurfaceIds?: ReadonlySet<string>;
}

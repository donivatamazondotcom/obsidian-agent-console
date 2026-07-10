/**
 * `deriveComposerAffordances` — the single pure resolver for HOW the composer
 * behaves: its send TARGET, how quick prompts fire, whether it carries context
 * across a launch, and which satellite controls (attachments, config
 * selectors) are live.
 *
 * WHY THIS EXISTS
 * The composer (`InputArea`) is reused on two surfaces — a live tab and the
 * zero-tab landing ([[Agent Console Close Last Tab to Empty State]]). On the
 * landing its mode/controls were hand-assembled as a ~23-prop pile at the
 * ChatView call site: the send target was IMPLIED by `lazyState:"idle"`,
 * attachments were force-`false`, no modes/models were passed, quick prompts
 * were rerouted to launch, and `@`-mention context was silently dropped. That
 * scattered, implicit decision is drift-prone and was the root of two bugs:
 *   - Send didn't launch a new session from the landing — the send *target*
 *     was implicit (inferred from lazyState), never resolved.
 *   - Pin-before-send was unsupported — the composer surfaced `@`-mention/pin
 *     but the launch path carried only text, silently dropping context.
 * This resolver makes the composer's mode + control composition ONE decision,
 * read by BOTH the landing and (follow-up) the in-tab composer so they cannot
 * drift.
 *
 * DESIGN
 *  - The send TARGET keys off `surface`, and this resolver is entirely
 *    connection-state-independent — it does NOT read `lazyState`. That is
 *    precisely the fix: the old landing inferred "launch" from
 *    `lazyState:"idle"`, coupling the target to the session state machine.
 *    Send *enablement* (which DOES depend on `lazyState`) remains
 *    `deriveSendAffordance`'s job; this resolver owns send *target* + control
 *    composition. No overlap.
 *  - `context:"carry"` on the landing (Decision, 2026-07-10): the launch
 *    carries the typed text AND pinned/`@`-mentioned notes into the spawned tab
 *    as first-message context. `"off"` would suppress the pin affordance;
 *    `"session"` (tab) attaches context to the live session.
 *  - `capabilities` is a COMPOSER-facing shape (`supportsImages`,
 *    `hasConfigSelectors`), NOT the ACP `AgentCapabilities` record: image
 *    support is a per-session prompt capability
 *    (`session.promptCapabilities.image`) and the mode/model/config selectors
 *    are driven by per-session `modes`/`models`/`configOptions` being
 *    non-empty — neither lives in the initialize-time `AgentCapabilities`
 *    record (whose `reportsModels` is always `false` at this SDK version).
 *  - `showConfigSelectors` gates on data/capability ONLY, never on connection
 *    state. An earlier draft gated it on `isSessionLive(lazyState)` — that was
 *    the exact "gate on connection state" anti-pattern the tenets forbid, and
 *    it baked in the model-selection capability gap under lazy acquisition
 *    (the picker was hidden until a session went live, so you couldn't pick a
 *    model before the first send). Presence keys off data/capability; ENGAGING
 *    the selector is what should trigger lazy acquisition — the consumer's job,
 *    not a visibility precondition here. See [[Model Selection Under Lazy
 *    Acquisition]] and [[Agent Console]] § Tenets → "Gate on data + intent, not
 *    connection state".
 *  - `quickPromptFire:"none"` when there are no quick prompts, so "fire with
 *    nothing to fire" is unrepresentable (tagged-union tenet).
 *
 * Pure — no React, no Obsidian. Exhaustively unit-testable.
 */

/** Which surface hosts the composer. */
export type ComposerSurface = "landing" | "tab";

/**
 * Composer-facing capabilities. Deliberately NOT the ACP `AgentCapabilities`
 * record (which describes session enumeration/restore, not the composer):
 *  - `supportsImages` ← `session.promptCapabilities?.image`
 *  - `hasConfigSelectors` ← any of `modes`/`models`/`configOptions` non-empty
 */
export interface ComposerCapabilities {
	/** Agent accepts image attachments (per-session prompt capability). */
	supportsImages: boolean;
	/** Any mode/model/config selector has options to offer. */
	hasConfigSelectors: boolean;
}

export interface ComposerAffordancesInput {
	/** Which surface the composer renders on. */
	surface: ComposerSurface;
	/** Composer-facing capabilities (see {@link ComposerCapabilities}). */
	capabilities: ComposerCapabilities;
	/** Whether the composer has any quick prompts to fire. */
	hasQuickPrompts: boolean;
}

/** Where a send is dispatched. */
export type ComposerSendMode =
	| "session" // send into this tab's (lazily-acquired) session
	| "launch"; // spawn a new tab on the default agent and send as first message

/** How a quick-prompt fire is dispatched. */
export type ComposerQuickPromptFire =
	| "current" // run in the current session
	| "launch" // spawn a new tab and run as first message
	| "none"; // no quick prompts to fire

/** What happens to composer context (pinned / `@`-mentioned notes) on send. */
export type ComposerContext =
	| "session" // attached to the live session
	| "carry" // carried into the spawned tab as first-message context
	| "off"; // no context affordance (suppress pin/`@`-mention)

/**
 * The resolved composer affordances. Resolved once so the landing and in-tab
 * composers cannot drift.
 */
export interface ComposerAffordances {
	/** Send target: the live session vs a new-tab launch. */
	sendMode: ComposerSendMode;
	/** Quick-prompt fire target. */
	quickPromptFire: ComposerQuickPromptFire;
	/** Context behavior on send. */
	context: ComposerContext;
	/** Show the image-attachment control. */
	showAttachments: boolean;
	/** Show the mode/model/config selectors. */
	showConfigSelectors: boolean;
}

/**
 * The single composer-affordance decision. See module doc for the rules.
 */
export function deriveComposerAffordances(
	input: ComposerAffordancesInput,
): ComposerAffordances {
	const { surface, capabilities, hasQuickPrompts } = input;

	if (surface === "landing") {
		// The landing is always a launcher: send + quick prompts spawn a new
		// tab; context is carried into it; the session-only satellite controls
		// (attachments, selectors) are inert — there is no live session yet.
		return {
			sendMode: "launch",
			quickPromptFire: hasQuickPrompts ? "launch" : "none",
			context: "carry",
			showAttachments: false,
			showConfigSelectors: false,
		};
	}

	// surface === "tab": send + quick prompts run in the tab's session; context
	// attaches to it. Satellite controls follow data/capability only — never
	// connection state (engaging a hidden-until-live selector is impossible, and
	// that was the model-selection gap; engaging IS the acquisition trigger).
	return {
		sendMode: "session",
		quickPromptFire: hasQuickPrompts ? "current" : "none",
		context: "session",
		showAttachments: capabilities.supportsImages,
		showConfigSelectors: capabilities.hasConfigSelectors,
	};
}

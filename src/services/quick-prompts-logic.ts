/**
 * quick-prompts-logic — pure decision/parse helpers for the Quick Prompts
 * feature. Zero React, zero Obsidian: the load-bearing decisions (parse, label
 * fallback, stable id, folder scoping, placeholder resolution, and the
 * fire/insert/queue/disabled action) are unit-testable without mounting the
 * React tree or an Obsidian harness — the same pattern as `message-queue-logic`
 * and `command-palette`.
 *
 * See [[Agent Console Quick Prompts and Workflows]] § Interaction model.
 */

import type { QuickPrompt, QuickPromptFileInput } from "../types/quick-prompt";

/** The single v1 placeholder. */
export const SELECTION_TOKEN = "{{selection}}";

// ============================================================================
// Parsing — frontmatter → QuickPrompt
// ============================================================================

/**
 * Strip a leading YAML frontmatter block (`---\n…\n---`) from raw note text,
 * returning the body. Notes without frontmatter are returned unchanged. The
 * real adapter reads frontmatter *fields* from Obsidian's metadata cache; this
 * only removes the fenced block so the body is clean prompt text.
 */
export function stripFrontmatter(raw: string): string {
	// Frontmatter must start at the very first line.
	if (!raw.startsWith("---")) return raw;
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
	if (!match) return raw;
	return raw.slice(match[0].length);
}

/** First non-empty string value among the given keys, else null. */
function firstStringField(
	fm: Record<string, unknown> | null,
	keys: string[],
): string | null {
	if (!fm) return null;
	for (const key of keys) {
		const value = fm[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return null;
}

/**
 * Label fallback chain: `description` → `name` → `title` → filename basename.
 */
export function deriveLabel(
	fm: Record<string, unknown> | null,
	basename: string,
): string {
	return firstStringField(fm, ["description", "name", "title"]) ?? basename;
}

/**
 * Stable, filename-derived slug id. Lowercased, non-alphanumeric runs collapse
 * to single hyphens, leading/trailing hyphens trimmed. Deterministic for a
 * given basename, so the id survives a folder re-scan (load-bearing for
 * per-prompt hotkeys, which are keyed by command id). Empty/symbol-only
 * basenames fall back to `untitled`.
 */
export function slugifyPromptId(basename: string): string {
	const slug = basename
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "untitled";
}

/** Normalize a frontmatter `tags` value (array or single string) to string[]. */
function normalizeTags(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const tags = value.filter((t): t is string => typeof t === "string");
		return tags.length > 0 ? tags : undefined;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		return [value];
	}
	return undefined;
}

/** Normalize an optional string frontmatter field. */
function normalizeString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

/**
 * Build a `QuickPrompt` from a parsed file. Pure — label fallback, stable id,
 * `usesSelection`, and the parsed-and-carried optional fields (`showOnTags`,
 * `alwaysShow`, `agent`, `mode`, `newTab`). Core does not act on the carried
 * fields (firing is always current-tab); they ride through so the later slices
 * need no re-parse.
 */
export function buildQuickPrompt(input: QuickPromptFileInput): QuickPrompt {
	const fm = input.frontmatter;
	return {
		id: slugifyPromptId(input.basename),
		label: deriveLabel(fm, input.basename),
		body: input.body,
		path: input.path,
		usesSelection: input.body.includes(SELECTION_TOKEN),
		// Contextual-chip scope (slice 2). Frontmatter key `show on tags`
		// (renamed from `tags` — that key collided with the note's own tags
		// property; clean rename, never released). Accepts an array or a single
		// string.
		showOnTags: fm ? normalizeTags(fm["show on tags"]) : undefined,
		// Global chip: show in the resting row on every note (slice 2, D6).
		alwaysShow: fm ? fm["always show"] === true : undefined,
		agent: fm ? normalizeString(fm["agent"]) : undefined,
		mode: fm ? normalizeString(fm["mode"]) : undefined,
		// Default target = new tab, via the `open in new tab` checkbox (D5).
		// No `newTab` back-compat — that key was never in a released build.
		newTab: fm ? fm["open in new tab"] === true : undefined,
	};
}

// ============================================================================
// Folder scoping
// ============================================================================

/**
 * Whether a vault path is a quick-prompt note: a `.md` file under the
 * configured folder (any depth). Boundary-safe — `Quick Prompts/x.md` matches
 * for folder `Quick Prompts`, but `Quick PromptsX/x.md` does not.
 */
export function isQuickPromptFile(path: string, folder: string): boolean {
	if (!path.toLowerCase().endsWith(".md")) return false;
	const normalized = folder.replace(/\/+$/, "");
	if (normalized.length === 0) return false;
	return path === `${normalized}` // (defensive; a folder is never a file)
		? false
		: path.startsWith(`${normalized}/`);
}

// ============================================================================
// Placeholder resolution
// ============================================================================

/**
 * Resolve `{{selection}}` to the current selection text (all occurrences). A
 * body with no token is returned verbatim. Null/empty selection resolves to an
 * empty string (the caller's decision logic handles the no-selection fallback
 * separately — see {@link decideQuickPromptAction}).
 */
export function resolvePromptText(
	body: string,
	selectionText: string | null,
): string {
	return body.split(SELECTION_TOKEN).join(selectionText ?? "");
}

// ============================================================================
// Fire / insert / queue / disabled decision — the browser-true 2×2
// ============================================================================

export type QuickPromptAction =
	| "fire"
	| "queue"
	| "insert"
	| "disabled"
	| "new-tab";

export type QuickPromptReason = "no-selection" | "unsent-draft";

/**
 * A quick-prompt activation gesture, decomposed into the two browser-true
 * axes (see [[Agent Console Quick Prompts UX Refinement]] § The action model):
 *
 * - **Where (Axis A):** `openElsewhere` — `Keymap.isModEvent` is truthy
 *   (⌘/⌃ or middle-click), clamped to a tab. With `foreground` (⇧) the new
 *   tab is switched to; without it, it opens in the background.
 * - **Commitment (Axis B):** `insert` — ⌥ is held → stage in the composer
 *   instead of sending (the browser's ⌥-click "capture, don't navigate").
 *
 * Bare ⇧ (no ⌘) is inert: `foreground` only modifies a new-tab open.
 */
export interface QuickPromptGesture {
	/** ⌘/⌃/middle-click — open in a new tab. */
	openElsewhere: boolean;
	/** ⇧ — when opening a new tab, switch to it (foreground). */
	foreground: boolean;
	/** ⌥ — insert/stage instead of send. */
	insert: boolean;
}

export interface QuickPromptDecisionInput extends QuickPromptGesture {
	/** The prompt's `open in new tab` checkbox — default target is a new tab. */
	defaultNewTab: boolean;
	/** The composer holds unsent draft text. */
	composerHasText: boolean;
	/** A turn is in flight (queue slot empty). */
	isStreaming: boolean;
	/** A message is already queued (queue-of-one slot full → composer locked). */
	isQueued: boolean;
	/** The prompt body references `{{selection}}`. */
	usesSelection: boolean;
	/** A non-empty editor selection exists. */
	hasSelection: boolean;
}

export interface QuickPromptDecision {
	action: QuickPromptAction;
	reason?: QuickPromptReason;
	/** For `new-tab`: send into the fresh tab (true) vs only seed its composer. */
	send?: boolean;
	/** For `new-tab`: switch to it (true) vs open in the background (false). */
	foreground?: boolean;
}

/**
 * Decide what a quick-prompt activation does, browser-true (2×2).
 *
 * **Where** — the target is a new tab when the gesture escalates
 * (`openElsewhere`, ⌘/middle-click) OR the prompt declares `open in new tab`.
 * A new-tab target **bypasses the current-tab guard** (queue/draft/streaming).
 * Foreground/background is inherited from the browser: a declared-new-tab
 * prompt **foregrounds** on a plain click (the `target="_blank"` analogue);
 * ⌘ forces **background**; ⌘⇧ foregrounds.
 *
 * **Commitment** — ⌥ (`insert`) stages instead of sending; a `{{selection}}`
 * prompt with nothing selected also stages (never fires half-formed).
 *
 * Current-tab precedence (no new-tab target): queued → `disabled`; ⌥ →
 * `insert`; no-selection → `insert`; unsent draft → `insert`; streaming →
 * `queue`; else `fire`.
 */
export function decideQuickPromptAction(
	input: QuickPromptDecisionInput,
): QuickPromptDecision {
	const targetNewTab = input.openElsewhere || input.defaultNewTab;
	if (targetNewTab) {
		// Plain click on a declared-new-tab prompt foregrounds (target=_blank);
		// an explicit ⌘ opens in the background unless ⇧ is also held.
		const foreground = input.openElsewhere ? input.foreground : true;
		if (input.usesSelection && !input.hasSelection) {
			return {
				action: "new-tab",
				send: false,
				foreground,
				reason: "no-selection",
			};
		}
		if (input.insert) return { action: "new-tab", send: false, foreground };
		return { action: "new-tab", send: true, foreground };
	}
	if (input.isQueued) return { action: "disabled" };
	if (input.insert) return { action: "insert" };
	if (input.usesSelection && !input.hasSelection) {
		return { action: "insert", reason: "no-selection" };
	}
	if (input.composerHasText) {
		return { action: "insert", reason: "unsent-draft" };
	}
	if (input.isStreaming) return { action: "queue" };
	return { action: "fire" };
}

// ============================================================================
// Plan = decision + resolved text (the single entry the hook calls)
// ============================================================================

export interface QuickPromptPlanContext extends QuickPromptGesture {
	composerHasText: boolean;
	isStreaming: boolean;
	isQueued: boolean;
	/** Current editor selection text, or null when nothing is selected. */
	selectionText: string | null;
}

export interface QuickPromptPlan {
	action: QuickPromptAction;
	/** Fully-resolved prompt text (placeholders substituted). */
	text: string;
	reason?: QuickPromptReason;
	/** For `new-tab`: send into the fresh tab vs only seed its composer. */
	send?: boolean;
	/** For `new-tab`: switch to it vs open in the background. */
	foreground?: boolean;
}

/**
 * Compose the decision and placeholder resolution into a single plan. The hook
 * calls this with the live composer/queue/selection state and then dispatches
 * per `action`.
 */
export function planQuickPromptFire(
	prompt: Pick<QuickPrompt, "body" | "usesSelection" | "newTab">,
	ctx: QuickPromptPlanContext,
): QuickPromptPlan {
	const hasSelection =
		ctx.selectionText != null && ctx.selectionText.length > 0;
	const decision = decideQuickPromptAction({
		openElsewhere: ctx.openElsewhere,
		foreground: ctx.foreground,
		insert: ctx.insert,
		composerHasText: ctx.composerHasText,
		isStreaming: ctx.isStreaming,
		isQueued: ctx.isQueued,
		usesSelection: prompt.usesSelection,
		hasSelection,
		defaultNewTab: prompt.newTab === true,
	});
	return {
		action: decision.action,
		reason: decision.reason,
		send: decision.send,
		foreground: decision.foreground,
		text: resolvePromptText(prompt.body, ctx.selectionText),
	};
}

// ============================================================================
// Execution — dispatch a plan to side-effecting action callbacks
// ============================================================================

/** Notice copy for the insert fallbacks (spec § Interaction model / Screen mocks). */
export const UNSENT_DRAFT_NOTICE = "Added to your draft — review and send";
export function noSelectionNotice(label: string): string {
	return `"${label}" needs a selection — dropped into the composer instead.`;
}
/** Toast shown when a prompt is sent into a new **background** tab. */
export function newTabStartedNotice(label: string): string {
	return `Started "${label}" in a new tab.`;
}
/** Toast shown when a prompt seeds a new **background** tab's composer (no send). */
export function newTabSeedNotice(label: string): string {
	return `Opened "${label}" in a new tab to edit.`;
}

/** Side-effecting actions the executor invokes per the planned action. */
export interface QuickPromptActions {
	/** Fire or queue: set the (empty) composer to `text` and dispatch through
	 *  the normal send path, which queues when a turn is streaming. */
	fireOrQueue(text: string): void;
	/** Insert `text` at the cursor, preserving any existing draft. */
	insert(text: string): void;
	/**
	 * Open a fresh tab/session and either send `text` there (`send: true`) or
	 * only seed its composer (`send: false`); `foreground` switches to the new
	 * tab vs opening it in the background. Bypasses the current-tab composer.
	 */
	openInNewTab(text: string, opts: { send: boolean; foreground: boolean }): void;
	/** Show a transient notice. */
	notify(message: string): void;
}

/**
 * Run a quick prompt: compute the plan from the live composer/queue/selection
 * context, then invoke the matching action. `disabled` (slot full) is a no-op.
 * Returns the plan so callers/tests can assert the chosen branch.
 */
export function executeQuickPrompt(
	prompt: Pick<QuickPrompt, "body" | "usesSelection" | "label" | "newTab">,
	ctx: QuickPromptPlanContext,
	actions: QuickPromptActions,
): QuickPromptPlan {
	const plan = planQuickPromptFire(prompt, ctx);
	switch (plan.action) {
		case "disabled":
			break;
		case "fire":
		case "queue":
			actions.fireOrQueue(plan.text);
			break;
		case "insert":
			actions.insert(plan.text);
			if (plan.reason === "no-selection") {
				actions.notify(noSelectionNotice(prompt.label));
			} else if (plan.reason === "unsent-draft") {
				actions.notify(UNSENT_DRAFT_NOTICE);
			}
			break;
		case "new-tab": {
			const send = plan.send ?? true;
			const foreground = plan.foreground ?? false;
			actions.openInNewTab(plan.text, { send, foreground });
			// Feedback only when the new tab is in the BACKGROUND (foreground
			// fires are self-evident — you land on the tab). A no-selection
			// seed explains itself with the no-selection notice instead.
			if (plan.reason === "no-selection") {
				actions.notify(noSelectionNotice(prompt.label));
			} else if (!foreground) {
				actions.notify(
					send
						? newTabStartedNotice(prompt.label)
						: newTabSeedNotice(prompt.label),
				);
			}
			break;
		}
	}
	return plan;
}

// ============================================================================
// Slice 2 — chip visibility (D6): always-show ∪ tag-matched
// ============================================================================

/**
 * Whether a prompt's `show on tags` scope matches the active note's tags.
 *
 * Contract (slice 2, D6): an **empty/undefined** scope matches **nothing** —
 * an unscoped prompt is NOT globally shown by default (that role belongs to
 * `alwaysShow`). A scoped prompt matches on **any** tag, with **nested**
 * matching: scope tag `NoteType` matches note tag `NoteType/DailyNote` (the
 * scope tag is the filter; a note tag nested under it counts). Comparison is
 * case-insensitive and tolerant of a leading `#`.
 */
export function tagsMatch(
	promptTags: string[] | undefined,
	noteTags: string[],
): boolean {
	if (!promptTags || promptTags.length === 0) return false;
	const clean = (t: string) => t.toLowerCase().replace(/^#/, "");
	const notes = noteTags.map(clean);
	return promptTags.some((promptTag) => {
		const p = clean(promptTag);
		return notes.some((n) => n === p || n.startsWith(`${p}/`));
	});
}

/**
 * Whether a prompt belongs in the **resting chip row** for the active note
 * (D6). Two explicit ways in — never the old "untagged ⇒ always shows":
 *
 * - `alwaysShow` (the `always show` checkbox) → a **global** chip, shown on
 *   every note regardless of tags.
 * - `showOnTags` matching the note's tags → a **contextual** chip.
 *
 * Neither ⇒ **search-only**: the prompt stays findable in the picker but never
 * enters the resting row. The single pure gating decision for chip presence.
 */
export function promptInRestingRow(
	prompt: Pick<QuickPrompt, "alwaysShow" | "showOnTags">,
	noteTags: string[],
): boolean {
	return prompt.alwaysShow === true || tagsMatch(prompt.showOnTags, noteTags);
}

/**
 * The resting chip set for the active note: `always-show ∪ tag-matched`.
 * Untagged + un-`always show` prompts are search-only and excluded here. Empty
 * result ⇒ the chips row renders nothing (no row).
 */
export function matchPromptsForNote(
	prompts: QuickPrompt[],
	noteTags: string[],
): QuickPrompt[] {
	return prompts.filter((prompt) => promptInRestingRow(prompt, noteTags));
}

/**
 * Whether a chip is disabled in place. A current-tab prompt (`!newTab`) is
 * disabled while a message is queued (composer locked, queue-of-one full); a
 * `newTab` prompt is never disabled (it spawns a fresh tab). Derived
 * render-time predicate — never a captured flag — so it stays correct as the
 * matched set changes on editor-tab switches.
 */
export function quickPromptButtonDisabled(
	prompt: Pick<QuickPrompt, "newTab">,
	hasPendingQueue: boolean,
): boolean {
	return !prompt.newTab && hasPendingQueue;
}

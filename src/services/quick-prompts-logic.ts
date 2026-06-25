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
 * `usesSelection`, and the parsed-and-carried optional fields (`tags`,
 * `agent`, `mode`, `newTab`). Core does not act on the carried fields (firing
 * is always current-tab); they ride through so the later slices need no
 * re-parse.
 */
export function buildQuickPrompt(input: QuickPromptFileInput): QuickPrompt {
	const fm = input.frontmatter;
	return {
		id: slugifyPromptId(input.basename),
		label: deriveLabel(fm, input.basename),
		body: input.body,
		path: input.path,
		usesSelection: input.body.includes(SELECTION_TOKEN),
		tags: fm ? normalizeTags(fm["tags"]) : undefined,
		agent: fm ? normalizeString(fm["agent"]) : undefined,
		mode: fm ? normalizeString(fm["mode"]) : undefined,
		newTab: fm ? fm["newTab"] === true : undefined,
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
// Fire / insert / queue / disabled decision
// ============================================================================

export type QuickPromptAction = "fire" | "queue" | "insert" | "disabled";

export type QuickPromptReason = "no-selection" | "unsent-draft";

export interface QuickPromptDecisionInput {
	/** A tweak modifier (⇧ or ⌥) is held → insert instead of fire. */
	modifier: boolean;
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
}

/**
 * Decide what a current-tab quick-prompt activation does. Precedence:
 *
 * 1. **queued (slot full)** → `disabled` (plain or modifier — composer is
 *    `readOnly`, nothing to insert into; Edit/Delete the pending one).
 * 2. **modifier** → `insert` (tweak-before-send; never fires).
 * 3. **`{{selection}}` with no selection** → `insert` (`no-selection`); a
 *    half-formed prompt is never fired/queued.
 * 4. **unsent draft present** → `insert` (`unsent-draft`); never discard,
 *    overwrite, or auto-send over a draft.
 * 5. **empty composer, streaming** → `queue` (parity with typed input).
 * 6. **empty composer, idle** → `fire`.
 */
export function decideQuickPromptAction(
	input: QuickPromptDecisionInput,
): QuickPromptDecision {
	if (input.isQueued) return { action: "disabled" };
	if (input.modifier) return { action: "insert" };
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

export interface QuickPromptPlanContext {
	modifier: boolean;
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
}

/**
 * Compose the decision and placeholder resolution into a single plan. The hook
 * calls this with the live composer/queue/selection state and then dispatches
 * per `action` (`fire`/`queue` → set composer + send; `insert` → drop at
 * cursor; `disabled` → no-op).
 */
export function planQuickPromptFire(
	prompt: Pick<QuickPrompt, "body" | "usesSelection">,
	ctx: QuickPromptPlanContext,
): QuickPromptPlan {
	const hasSelection =
		ctx.selectionText != null && ctx.selectionText.length > 0;
	const decision = decideQuickPromptAction({
		modifier: ctx.modifier,
		composerHasText: ctx.composerHasText,
		isStreaming: ctx.isStreaming,
		isQueued: ctx.isQueued,
		usesSelection: prompt.usesSelection,
		hasSelection,
	});
	return {
		action: decision.action,
		reason: decision.reason,
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

/** Side-effecting actions the executor invokes per the planned action. */
export interface QuickPromptActions {
	/** Fire or queue: set the (empty) composer to `text` and dispatch through
	 *  the normal send path, which queues when a turn is streaming. */
	fireOrQueue(text: string): void;
	/** Insert `text` at the cursor, preserving any existing draft. */
	insert(text: string): void;
	/** Show a transient notice. */
	notify(message: string): void;
}

/**
 * Run a quick prompt: compute the plan from the live composer/queue/selection
 * context, then invoke the matching action. `disabled` (slot full) is a no-op.
 * Returns the plan so callers/tests can assert the chosen branch.
 *
 * This is the single behavior the `useQuickPrompts` hook performs; keeping it
 * pure (callbacks injected) makes the picker/chip out-of-band-but-guarded
 * behavior (T18) testable without mounting React.
 */
export function executeQuickPrompt(
	prompt: Pick<QuickPrompt, "body" | "usesSelection" | "label">,
	ctx: QuickPromptPlanContext,
	actions: QuickPromptActions,
): QuickPromptPlan {
	const plan = planQuickPromptFire(prompt, ctx);
	switch (plan.action) {
		case "disabled":
			// Slot full — composer is locked; nothing to do (Edit/Delete the
			// pending message instead).
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
	}
	return plan;
}

// ============================================================================
// Slice 2 — contextual chips: tag matching + queued-disable predicate
// ============================================================================

/**
 * Whether a prompt's tags match the active note's tags.
 *
 * - **Untagged prompts always match** (globally-shown).
 * - A tagged prompt matches on **any** tag, with **nested** matching: prompt
 *   tag `NoteType` matches note tag `NoteType/DailyNote` (prompt tag is the
 *   filter; a note tag nested under it counts). Comparison is
 *   case-insensitive and tolerant of a leading `#`.
 */
export function promptMatchesTags(
	promptTags: string[] | undefined,
	noteTags: string[],
): boolean {
	if (!promptTags || promptTags.length === 0) return true;
	const clean = (t: string) => t.toLowerCase().replace(/^#/, "");
	const notes = noteTags.map(clean);
	return promptTags.some((promptTag) => {
		const p = clean(promptTag);
		return notes.some((n) => n === p || n.startsWith(`${p}/`));
	});
}

/**
 * The contextual chip set for the active note: untagged prompts plus those
 * whose tags match. Empty result ⇒ the chips row renders nothing (no row).
 */
export function matchPromptsForNote(
	prompts: QuickPrompt[],
	noteTags: string[],
): QuickPrompt[] {
	return prompts.filter((prompt) => promptMatchesTags(prompt.tags, noteTags));
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

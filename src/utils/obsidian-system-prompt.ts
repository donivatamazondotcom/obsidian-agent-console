import {
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
} from "./system-instructions";
import { isSameDirectory } from "./platform";

/**
 * Obsidian system prompt — the honest, plugin-generic orientation injected on
 * the first message of a session so a connected agent behaves natively in
 * Obsidian out of the box.
 *
 * This module is the pure composer (a resolver, per the Agent Console tenets):
 * total, no throw, no React/Obsidian runtime. It assembles a briefing string
 * from a settings selection + live session state `{ cwd, vaultRoot }`. The
 * services layer wraps the result in an `<obsidian_system_instruction>` block
 * at emit time (so the existing tab-label leak-stripper handles it) — that
 * wrapping is NOT this module's concern.
 *
 * Spec: [[Obsidian System Prompt]].
 */

// ── Block constants (shipped defaults) ──────────────────────────────────────

export const HOST_IDENTITY_BLOCK =
	"You are running inside Obsidian via the Agent Console plugin.";

/**
 * Rendering affordances. Folds in the three shipped formatting instructions
 * (wikilink, table, LaTeX) so they live in exactly one place and the legacy
 * constants stay the single source of truth for the leak-stripper sentinels.
 */
export const RENDERING_AFFORDANCES_BLOCK = [
	"Your replies are shown to the user in a chat panel and rendered as Obsidian-flavored markdown (display only — they are not saved as notes).",
	WIKI_LINK_INSTRUCTION,
	"Prefer wikilinks when referencing notes so they connect in the user's knowledge graph.",
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
	"Fenced `mermaid` code blocks render as diagrams, and callouts, embeds, and images render natively.",
].join(" ");

export const VAULT_COLLABORATION_BLOCK =
	"This working directory is the user's Obsidian vault, a linked knowledge " +
	"graph of markdown notes. When you create or edit notes, use Obsidian " +
	"conventions: callouts (`> [!note]`), task lists (`- [ ]`), tags (`#tag`), " +
	"and YAML frontmatter.";

/** Working-directory block is parameterized by the resolved cwd. */
export function workingDirectoryBlock(cwd: string): string {
	return `Your working directory is ${cwd}.`;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ObsidianSystemPromptBlocks {
	hostIdentity: boolean;
	rendering: boolean;
	workingDirectory: boolean;
	vaultCollaboration: boolean;
}

export type ObsidianSystemPromptMode = "options" | "full";

export interface ObsidianSystemPromptSettings {
	blocks: ObsidianSystemPromptBlocks;
	/**
	 * The user's own additions (vault structure, conventions, preferences).
	 * Appended after the composed blocks in "options" mode. The scope-safe
	 * personalization on-ramp — user-authored, never plugin-derived.
	 */
	appendText?: string;
	/**
	 * Full hand-edited prompt. Used ONLY in "full" mode, where it replaces the
	 * entire composed prompt. The "Edit full prompt" escape seeds it with the
	 * current composed text so the user edits the real prompt.
	 */
	customText?: string;
	/** "options" = blocks + appendText (cwd-gated); "full" = customText verbatim. */
	mode?: ObsidianSystemPromptMode;
}

export interface ObsidianSystemPromptContext {
	/** The session's resolved working directory. */
	cwd: string;
	/** The vault base path. */
	vaultRoot: string;
}

export const DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS: ObsidianSystemPromptBlocks = {
	hostIdentity: true,
	rendering: true,
	workingDirectory: true,
	vaultCollaboration: true,
};

// ── Gating ────────────────────────────────────────────────────────────────────

/**
 * True when `cwd` is the vault root OR a descendant of it. The
 * vault-collaboration claim is honest only inside the vault tree — a cwd set to
 * an external repo must not get the "you can edit the user's vault" line.
 *
 * Broader than the spec's original `deriveCwdBanner === false` shorthand (which
 * is true only at the exact vault root): a vault SUBFOLDER cwd is still the
 * vault, so the claim should hold there too.
 */
export function isCwdInsideVault(cwd: string, vaultRoot: string): boolean {
	if (!cwd || !vaultRoot) return false;
	if (isSameDirectory(cwd, vaultRoot)) return true;
	const norm = (p: string): string =>
		p.replace(/\\/g, "/").replace(/\/+$/, "");
	return norm(cwd).startsWith(norm(vaultRoot) + "/");
}

// ── Composer ──────────────────────────────────────────────────────────────────

/**
 * Compose the host-context briefing.
 *
 * Returns the assembled briefing text, or `null` when nothing is produced.
 *
 * - In "full" mode `customText` replaces everything (verbatim, no gating).
 * - In "options" mode, enabled blocks join in a stable order, then the user's
 *   `appendText` ("Your vault context") is appended.
 * - The working-directory block is omitted when `cwd` is empty.
 * - The vault-collaboration block is gated on {@link isCwdInsideVault}.
 */
export function composeObsidianSystemPrompt(
	settings: ObsidianSystemPromptSettings,
	ctx: ObsidianSystemPromptContext,
): string | null {
	if ((settings.mode ?? "options") === "full") {
		const full = (settings.customText ?? "").trim();
		return full || null;
	}

	const { blocks } = settings;
	const parts: string[] = [];

	if (blocks.hostIdentity) parts.push(HOST_IDENTITY_BLOCK);
	if (blocks.rendering) parts.push(RENDERING_AFFORDANCES_BLOCK);
	if (blocks.workingDirectory && ctx.cwd) {
		parts.push(workingDirectoryBlock(ctx.cwd));
	}
	if (blocks.vaultCollaboration && isCwdInsideVault(ctx.cwd, ctx.vaultRoot)) {
		parts.push(VAULT_COLLABORATION_BLOCK);
	}

	const append = (settings.appendText ?? "").trim();
	if (append) parts.push(append);

	return parts.length > 0 ? parts.join("\n\n") : null;
}

// ── Settings normalization (trust boundary) ────────────────────────────────

export const DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS: ObsidianSystemPromptSettings =
	{
		blocks: { ...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS },
		appendText: "",
		customText: "",
		mode: "options",
	};

/**
 * Normalize a raw, untrusted `obsidianSystemPrompt` value from persisted config
 * into a valid {@link ObsidianSystemPromptSettings}. Missing/garbage values fall
 * back to the shipped defaults (all blocks on, no custom text). Never throws.
 *
 * A fresh install or a pre-feature upgrade has no `obsidianSystemPrompt` key →
 * full defaults. (The dormant `promptInjection` keys from the superseded
 * Prompt Injection Defaults work are simply ignored here.)
 */
export function normalizeObsidianSystemPromptSettings(
	raw: unknown,
): ObsidianSystemPromptSettings {
	const obj =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const rawBlocks =
		obj.blocks && typeof obj.blocks === "object" && !Array.isArray(obj.blocks)
			? (obj.blocks as Record<string, unknown>)
			: {};
	const b = (k: keyof ObsidianSystemPromptBlocks): boolean => {
		const v = rawBlocks[k];
		return typeof v === "boolean"
			? v
			: DEFAULT_OBSIDIAN_SYSTEM_PROMPT_BLOCKS[k];
	};
	const appendText =
		typeof obj.appendText === "string" ? obj.appendText : "";
	const customText =
		typeof obj.customText === "string" ? obj.customText : "";
	// Migration: a pre-mode config carrying non-empty customText meant
	// "replace" → preserve as "full"; otherwise default to "options".
	const mode: ObsidianSystemPromptMode =
		obj.mode === "full"
			? "full"
			: obj.mode === "options"
				? "options"
				: customText.trim()
					? "full"
					: "options";
	return {
		blocks: {
			hostIdentity: b("hostIdentity"),
			rendering: b("rendering"),
			workingDirectory: b("workingDirectory"),
			vaultCollaboration: b("vaultCollaboration"),
		},
		appendText,
		customText,
		mode,
	};
}

// ── Reset confirmation gate ────────────────────────────────────────────────

/**
 * True when the settings carry text the user typed — the "Your vault context"
 * append field or a hand-edited full prompt. Resetting to defaults discards
 * that text, so the UI confirms before resetting only when this is true; a
 * toggle-only difference is cheap to redo and resets without a prompt.
 *
 * Pure decision (per the resolver tenet) so the confirm gate is unit-testable
 * independently of the settings UI.
 */
export function obsidianSystemPromptHasUserText(
	settings: ObsidianSystemPromptSettings,
): boolean {
	return (
		(settings.appendText ?? "").trim() !== "" ||
		(settings.customText ?? "").trim() !== ""
	);
}

import {
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
} from "./system-instructions";
import { isSameDirectory } from "./platform";

/**
 * Host Context Briefing — the honest, plugin-generic orientation injected on
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
 * Spec: [[Obsidian Host Context Briefing]].
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
	"Your replies are shown to the user rendered as Obsidian-flavored markdown.",
	WIKI_LINK_INSTRUCTION,
	TABLE_INSTRUCTION,
	LATEX_MATH_INSTRUCTION,
	"Fenced `mermaid` code blocks render as diagrams, and callouts, embeds, and images render natively.",
].join(" ");

export const VAULT_COLLABORATION_BLOCK =
	"This working directory is the user's Obsidian vault, a linked knowledge " +
	"graph of markdown notes. You can read and edit these notes to collaborate " +
	"with the user on artifacts in real time.";

/** Working-directory block is parameterized by the resolved cwd. */
export function workingDirectoryBlock(cwd: string): string {
	return `Your working directory is ${cwd}.`;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface HostContextBriefingBlocks {
	hostIdentity: boolean;
	rendering: boolean;
	workingDirectory: boolean;
	vaultCollaboration: boolean;
}

export interface HostContextBriefingSettings {
	blocks: HostContextBriefingBlocks;
	/**
	 * Raw-edit escape (Open Q1). When set to a non-empty string, it is injected
	 * verbatim and block composition + cwd-gating are bypassed entirely — the
	 * user has taken exact control of the briefing text.
	 */
	customText?: string;
}

export interface HostContextBriefingContext {
	/** The session's resolved working directory. */
	cwd: string;
	/** The vault base path. */
	vaultRoot: string;
}

export const DEFAULT_HOST_CONTEXT_BRIEFING_BLOCKS: HostContextBriefingBlocks = {
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
 * Returns the assembled briefing text, or `null` when there is nothing to
 * inject (no custom text and no enabled block produced content).
 *
 * - `customText` (non-empty) short-circuits everything → injected verbatim.
 * - Otherwise enabled blocks are joined in a stable order with blank lines.
 * - The working-directory block is omitted when `cwd` is empty.
 * - The vault-collaboration block is gated on {@link isCwdInsideVault}.
 */
export function composeHostContextBriefing(
	settings: HostContextBriefingSettings,
	ctx: HostContextBriefingContext,
): string | null {
	const custom = (settings.customText ?? "").trim();
	if (custom) return custom;

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

	return parts.length > 0 ? parts.join("\n\n") : null;
}

// ── Settings normalization (trust boundary) ────────────────────────────────

export const DEFAULT_HOST_CONTEXT_BRIEFING_SETTINGS: HostContextBriefingSettings =
	{
		blocks: { ...DEFAULT_HOST_CONTEXT_BRIEFING_BLOCKS },
		customText: "",
	};

/**
 * Normalize a raw, untrusted `hostContextBriefing` value from persisted config
 * into a valid {@link HostContextBriefingSettings}. Missing/garbage values fall
 * back to the shipped defaults (all blocks on, no custom text). Never throws.
 *
 * A fresh install or a pre-feature upgrade has no `hostContextBriefing` key →
 * full defaults. (The dormant `promptInjection` keys from the superseded
 * Prompt Injection Defaults work are simply ignored here.)
 */
export function normalizeHostContextBriefingSettings(
	raw: unknown,
): HostContextBriefingSettings {
	const obj =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const rawBlocks =
		obj.blocks && typeof obj.blocks === "object" && !Array.isArray(obj.blocks)
			? (obj.blocks as Record<string, unknown>)
			: {};
	const b = (k: keyof HostContextBriefingBlocks): boolean => {
		const v = rawBlocks[k];
		return typeof v === "boolean"
			? v
			: DEFAULT_HOST_CONTEXT_BRIEFING_BLOCKS[k];
	};
	return {
		blocks: {
			hostIdentity: b("hostIdentity"),
			rendering: b("rendering"),
			workingDirectory: b("workingDirectory"),
			vaultCollaboration: b("vaultCollaboration"),
		},
		customText: typeof obj.customText === "string" ? obj.customText : "",
	};
}

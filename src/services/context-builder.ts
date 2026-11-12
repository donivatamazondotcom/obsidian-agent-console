/**
 * Context builder — produces PromptContent blocks for crystallized notes
 * (Channel 1) and selection (Channel 2).
 *
 * Pure function. No side effects, no vault reads, no React.
 * See: ACP Context Note Lifecycle spec § How Context Is Provided to the Agent.
 */
import type { ContextNote } from "../types/context";
import type { PromptContent } from "../types/chat";
import {
	takeLeadingSentence,
	takeLeadingWrappedBlock,
} from "../utils/injected-blocks";
import { buildFileUri as fileUriFromAbsolute } from "../utils/paths";
import { convertWindowsPathToWsl } from "../utils/platform";

export interface BuildContextBlocksInput {
	contextNotes: ContextNote[];
	selection: {
		path: string;
		fromLine: number;
		toLine: number;
		text: string;
	} | null;
	useEmbeddedContext: boolean;
	vaultPath: string;
	/**
	 * Windows WSL mode: link to the WSL path (`/mnt/c/...`) the agent sees,
	 * as @-mentions already do (I324 review).
	 */
	convertToWsl?: boolean;
	/**
	 * Channel 1 bodies to embed this turn, keyed by vault-relative path
	 * ([[ACP Context Note Hydration]] H1). The caller reads and gates them;
	 * this builder stays pure. A note absent from the map is reference-only.
	 */
	hydrationBodies?: ReadonlyMap<string, string>;
}

/** Derive display name from path (basename without extension). */
function displayName(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * A note's `file://` link: the vault root joined with its vault-relative
 * path, through the same helpers @-mentions use, so Windows paths come out
 * as `file:///C:/...` and WSL mode links to `/mnt/c/...` (I324 review).
 */
function buildFileUri(
	vaultPath: string,
	notePath: string,
	convertToWsl = false,
): string {
	let abs = vaultPath ? `${vaultPath}/${notePath}` : notePath;
	if (convertToWsl) abs = convertWindowsPathToWsl(abs);
	return fileUriFromAbsolute(abs);
}

/**
 * Build prompt content blocks for crystallized context notes + selection.
 *
 * Channel 1 (crystallized): reference-only (Decision #23), except a note in
 * `hydrationBodies`, whose body is embedded once (Hydration H1).
 * Channel 2 (selection): inlined content, hard hint.
 */
export function buildContextBlocks(input: BuildContextBlocksInput): PromptContent[] {
	const blocks: PromptContent[] = [];

	// Channel 1: Crystallized notes
	for (const note of input.contextNotes) {
		const body = input.hydrationBodies?.get(note.path);
		if (body !== undefined) {
			const ref = buildFileUri(input.vaultPath, note.path, input.convertToWsl);
			if (input.useEmbeddedContext) {
				// Body + the usual link. The link keeps the ref handle on every
				// message and is what replays as the pill's file chip (I222 a3,
				// I242); the resource carries the one-time body.
				blocks.push({
					type: "resource",
					resource: { uri: ref, mimeType: "text/markdown", text: body },
					annotations: { audience: ["assistant"], priority: 0.6 },
				});
				blocks.push({
					type: "resource_link",
					uri: ref,
					name: displayName(note.path),
					mimeType: "text/markdown",
				});
			} else {
				blocks.push({
					type: "text",
					text: `<obsidian_context_note ref="${ref}">\nThe user has pinned this note as context for this chat. Its content follows as a point-in-time snapshot. Use the Read tool with the ref path above for the current version if needed.\n\n${body}\n</obsidian_context_note>`,
				});
			}
			continue;
		}
		if (input.useEmbeddedContext) {
			blocks.push({
				type: "resource_link",
				uri: buildFileUri(input.vaultPath, note.path, input.convertToWsl),
				name: displayName(note.path),
				mimeType: "text/markdown",
			});
		} else {
			const ref = buildFileUri(input.vaultPath, note.path, input.convertToWsl);
			blocks.push({
				type: "text",
				text: `<obsidian_context_note ref="${ref}">\nThe user has set this note as context for this chat. The conversation involves this note. Use the Read tool to examine its content when relevant.\n</obsidian_context_note>`,
			});
		}
	}

	// Channel 2: Selection
	if (input.selection) {
		const { path, fromLine, toLine, text } = input.selection;
		const ref = buildFileUri(input.vaultPath, path, input.convertToWsl);

		if (input.useEmbeddedContext) {
			blocks.push({
				type: "resource",
				resource: {
					uri: ref,
					mimeType: "text/markdown",
					text,
				},
				annotations: {
					audience: ["assistant"],
					priority: 0.9,
				},
			});
			blocks.push({
				type: "text",
				text: selectionHint(fromLine, toLine),
			});
		} else {
			blocks.push({
				type: "text",
				text: `<obsidian_selection ref="${ref}" lines="${fromLine}-${toLine}">\n${text}\n\nThe user is focusing on this text right now.\n</obsidian_selection>`,
			});
		}
	}

	return blocks;
}

/** Wrapper tags {@link buildContextBlocks} emits on the text (non-embedded) path. */
const CONTEXT_BLOCK_TAGS = ["obsidian_context_note", "obsidian_selection"] as const;

/** Bare hint sent after an embedded selection resource. */
function selectionHint(fromLine: number, toLine: number): string {
	return `The user is focusing on lines ${fromLine}-${toLine} in the above note right now.`;
}
const SELECTION_HINT =
	/^The user is focusing on lines \d+-\d+ in the above note right now\./;

/**
 * Inverse of {@link buildContextBlocks} for replayed text (I222): remove ONE
 * complete leading block this builder injected, or return null. Composed by
 * `stripInjectedPromptText` in message-sender.
 */
export function takeLeadingContextBlock(text: string): string | null {
	return (
		takeLeadingWrappedBlock(text, CONTEXT_BLOCK_TAGS) ??
		takeLeadingSentence(text, SELECTION_HINT)
	);
}

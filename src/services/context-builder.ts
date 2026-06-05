/**
 * Context builder — produces PromptContent blocks for crystallized notes
 * (Channel 1) and selection (Channel 2).
 *
 * Pure function. No side effects, no vault reads, no React.
 * See: ACP Context Note Lifecycle spec § How Context Is Provided to the Agent.
 */
import type { ContextNote } from "../types/context";
import type { PromptContent } from "../types/chat";

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
}

/** Derive display name from path (basename without extension). */
function displayName(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

function buildFileUri(vaultPath: string, notePath: string): string {
	const abs = `${vaultPath}/${notePath}`;
	return `file://${abs}`;
}

/**
 * Build prompt content blocks for crystallized context notes + selection.
 *
 * Channel 1 (crystallized): reference-only (Decision #23).
 * Channel 2 (selection): inlined content, hard hint.
 */
export function buildContextBlocks(input: BuildContextBlocksInput): PromptContent[] {
	const blocks: PromptContent[] = [];

	// Channel 1: Crystallized notes
	for (const note of input.contextNotes) {
		if (input.useEmbeddedContext) {
			blocks.push({
				type: "resource_link",
				uri: buildFileUri(input.vaultPath, note.path),
				name: displayName(note.path),
				mimeType: "text/markdown",
			});
		} else {
			const ref = buildFileUri(input.vaultPath, note.path);
			blocks.push({
				type: "text",
				text: `<obsidian_context_note ref="${ref}">\nThe user has set this note as context for this chat. The conversation involves this note. Use the Read tool to examine its content when relevant.\n</obsidian_context_note>`,
			});
		}
	}

	// Channel 2: Selection
	if (input.selection) {
		const { path, fromLine, toLine, text } = input.selection;
		const ref = buildFileUri(input.vaultPath, path);

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
				text: `The user is focusing on lines ${fromLine}-${toLine} in the above note right now.`,
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

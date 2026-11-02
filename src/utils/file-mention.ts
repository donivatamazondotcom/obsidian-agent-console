/**
 * The `[@name](file://…)` mention Claude Code writes for a resource link
 * (I242). Pure pattern shared by the ACP replay parser and the session-title
 * resolver, so it lives in a leaf both layers may import.
 */
export const FILE_MENTION = String.raw`\[@([^\]\n]+)\]\((file:\/\/[^)\n]+)\)`;

/** True when a title is nothing but one file mention (Claude Code, I242). */
export function isFileMentionTitle(title: string): boolean {
	return new RegExp(`^${FILE_MENTION}\\s*$`).test(title.trim());
}

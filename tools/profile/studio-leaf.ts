/**
 * Find the Agent Console chat leaf in a parsed `.obsidian/workspace.json`.
 * The seeder keys the restored tabs by this leaf id, so a miss means no
 * tabs are seeded. Matches the current view type and the pre-rename one.
 *
 * Spec: [[Agent Console Release Quality Gates]] § Gate B-phase2.
 */
const CHAT_VIEW_TYPES = new Set([
	"agent-console-chat-view",
	"agent-client-chat-view",
]);

export function findAgentLeafId(workspace: unknown): string | null {
	let found: string | null = null;
	const walk = (n: unknown): void => {
		if (found !== null || !n || typeof n !== "object") return;
		const node = n as Record<string, unknown>;
		const state = node.state as Record<string, unknown> | undefined;
		if (
			node.type === "leaf" &&
			typeof node.id === "string" &&
			typeof state?.type === "string" &&
			CHAT_VIEW_TYPES.has(state.type)
		) {
			found = node.id;
			return;
		}
		for (const v of Object.values(node)) walk(v);
	};
	walk(workspace);
	return found;
}

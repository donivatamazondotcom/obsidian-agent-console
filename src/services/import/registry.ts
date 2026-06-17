import type { ImportSource } from "./ImportSource";
import {
	createAgentClientAdapter,
	type AgentClientAdapterDeps,
} from "./agentClientAdapter";

/**
 * All import sources available in this build. v1.2.0 ships agent-client only
 * (D5); register another source by adding a factory call here once a real
 * demand signal exists.
 */
export function createImportSources(
	deps: AgentClientAdapterDeps,
): ImportSource[] {
	return [createAgentClientAdapter(deps)];
}

/**
 * First source whose config is detected, or null if none. Used by the
 * first-run auto-offer and the import command to pick what to show.
 */
export async function firstDetectedSource(
	sources: ImportSource[],
): Promise<ImportSource | null> {
	for (const source of sources) {
		if (await source.detect()) return source;
	}
	return null;
}

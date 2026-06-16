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

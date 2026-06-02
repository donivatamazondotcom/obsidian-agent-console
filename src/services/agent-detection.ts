import { Platform } from "obsidian";
import { resolveCommandPath, resolveCommandPathInWsl } from "../utils/paths";

/** A known agent and the command used to detect its presence on PATH. */
export interface AgentProbe {
	/** Agent id (matches the configured agent's id). */
	id: string;
	/** Executable/command name to resolve on PATH. */
	command: string;
}

export interface DetectOptions {
	/** Windows WSL mode (resolve inside the WSL distribution). */
	wslMode?: boolean;
	/** Optional WSL distribution name. */
	wslDistribution?: string;
}

/**
 * Detect which known agents are installed by resolving each command on PATH.
 *
 * Probes run in parallel via the login-shell resolver in utils/paths, which
 * picks up the user's PATH even when Obsidian was launched from the GUI (the
 * macOS GUI-PATH gotcha). This is a presence check only — it does not verify
 * the binary speaks a compatible ACP version; connection failures are
 * surfaced separately at spawn time.
 *
 * @returns Set of agent ids whose command resolved on PATH.
 */
export async function detectAvailableAgents(
	probes: AgentProbe[],
	options: DetectOptions = {},
): Promise<Set<string>> {
	const useWsl = Platform.isWin && options.wslMode === true;
	const resolved = await Promise.all(
		probes.map(async ({ id, command }) => {
			if (!command || command.trim().length === 0) return null;
			const path = useWsl
				? await resolveCommandPathInWsl(command, options.wslDistribution)
				: await resolveCommandPath(command);
			return path ? id : null;
		}),
	);
	return new Set(resolved.filter((id): id is string => id !== null));
}

/**
 * Pick the default agent id: the first probe, in priority order, whose agent
 * resolved. Returns null when none of the probes resolved.
 */
export function pickDefaultAgentId(
	probes: AgentProbe[],
	available: Set<string>,
): string | null {
	for (const { id } of probes) {
		if (available.has(id)) {
			return id;
		}
	}
	return null;
}

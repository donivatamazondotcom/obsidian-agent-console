/**
 * `agentLaunchKey` — the identity of one way of launching an agent, used to
 * key the persisted capability cache (I260).
 *
 * Capabilities belong to the launch, not the agent id: one agent id can run
 * different servers (Kiro CLI V2 can't list sessions, V3 can), and the same
 * binary under two custom agents reports the same capabilities. The key is the
 * command plus the Kiro engine. Every other agent is "v2" (no engine rewrite).
 *
 * The write side builds it from the live launch config (`AcpClient`); the
 * read side from the tab's resolved settings. Both call this one function, so
 * they cannot drift. Pure and total.
 */
export function agentLaunchKey(launch: {
	command: string;
	kiroEngine?: "v2" | "v3";
}): string {
	const engine = launch.kiroEngine === "v3" ? "v3" : "v2";
	return `${engine}|${launch.command.trim()}`;
}

import { describe, it, expect } from "vitest";
import { checkAgentUpdate } from "../update-checker";

/**
 * Codex ACP package rename: `@zed-industries/codex-acp` was deprecated on npm
 * (frozen at 0.16.0) and replaced by `@agentclientprotocol/codex-acp`. Users
 * still running the old package must be nudged to migrate. Entered at the
 * public `checkAgentUpdate` seam (the runtime path), not the private maps.
 */
describe("checkAgentUpdate — codex package migration", () => {
	it("nudges users on the deprecated @zed-industries/codex-acp to the new package", async () => {
		const result = await checkAgentUpdate({
			name: "@zed-industries/codex-acp",
		});

		expect(result).not.toBeNull();
		expect(result?.variant).toBe("info");
		// Migration suggestion uninstalls the old package and installs the new one.
		expect(result?.suggestion).toContain(
			"npm uninstall -g @zed-industries/codex-acp",
		);
		expect(result?.suggestion).toContain(
			"npm install -g @agentclientprotocol/codex-acp",
		);
	});

	it("does not flag the new @agentclientprotocol/codex-acp package for migration", async () => {
		// No version supplied ⇒ no network version check; migration map must not
		// match the current package name, so there is nothing to report.
		const result = await checkAgentUpdate({
			name: "@agentclientprotocol/codex-acp",
		});

		expect(result).toBeNull();
	});
});

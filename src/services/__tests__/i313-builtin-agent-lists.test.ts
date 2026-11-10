/**
 * I313: every built-in agent goes through one list.
 *
 * Built-ins were listed by hand in several places, and the OpenCode built-in
 * (#218) reached only some of them. So an OpenCode default fell back to Claude
 * Code on every settings load, ChatPanel named the agent `opencode-acp`, the
 * getting-started dead-end check ignored it, and a custom agent could take its
 * id. The fix makes `services/builtin-agents.ts` the only hand-written list.
 *
 * The guard derives the built-ins from DEFAULT_SETTINGS itself (every entry
 * with an `id`), so the next built-in is covered without editing this file.
 *
 * Spec: [[I313 OpenCode default resets on restart and its name shows as an id]].
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAvailableAgentsFromSettings,
	findAgentSettings,
	collectAgentIdsExcept,
	getCurrentAgent,
	resolveUniqueAgentId,
} from "../session-helpers";
import { DEFAULT_SETTINGS, normalizeRawSettings as normalize } from "../settings-normalizer";

/** Load raw settings the way plugin.ts does; secret ids pass through unchanged. */
const normalizeRawSettings = (raw: Record<string, unknown>) =>
	normalize(raw, DEFAULT_SETTINGS, (_a: string, _b: string, current: string) => current);
import {
	builtInAgentIds,
	builtInAgentSettings,
	builtInAgentCommandsKey,
} from "../builtin-agents";

/** Every DEFAULT_SETTINGS entry that is an agent (an object with an id). */
const BUILT_INS = Object.values(DEFAULT_SETTINGS).filter(
	(v): v is { id: string; displayName: string; command: string } =>
		!!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { id?: unknown }).id === "string",
);

describe("I313: built-in agents come from one list", () => {
	it("finds at least the six built-ins in DEFAULT_SETTINGS", () => {
		expect(BUILT_INS.map((a) => a.id)).toEqual(
			expect.arrayContaining(["claude-code-acp", "codex-acp", "gemini-cli", "kiro-cli", "opencode-acp", "antigravity-acp"]),
		);
	});

	it.each(BUILT_INS.map((a) => [a.id, a] as const))("%s appears in every derived list", (id, agent) => {
		expect(builtInAgentSettings(DEFAULT_SETTINGS).map((a) => a.id)).toContain(id);
		expect(builtInAgentIds(DEFAULT_SETTINGS)).toContain(id);
		expect(getAvailableAgentsFromSettings(DEFAULT_SETTINGS).map((a) => a.id)).toContain(id);
		expect(findAgentSettings(DEFAULT_SETTINGS, id)?.id).toBe(id);
		expect(collectAgentIdsExcept(DEFAULT_SETTINGS, -1)).toContain(id);
		expect(builtInAgentCommandsKey(DEFAULT_SETTINGS).split("\u0000")).toContain(agent.command);
	});

	it.each(BUILT_INS.map((a) => [a.id] as const))("a %s default survives a settings load", (id) => {
		expect(normalizeRawSettings({ defaultAgentId: id }).defaultAgentId).toBe(id);
	});

	it.each(BUILT_INS.map((a) => [a.id, a.displayName] as const))(
		"the header names %s by its display name",
		(id, name) => {
			expect(getCurrentAgent(DEFAULT_SETTINGS, id).displayName).toBe(name);
		},
	);

	it("an unknown agent id still falls back to Claude Code on load", () => {
		expect(normalizeRawSettings({ defaultAgentId: "test-agent-gone" }).defaultAgentId).toBe("claude-code-acp");
	});

	it("a custom agent renamed to a built-in id gets a suffix", () => {
		const taken = collectAgentIdsExcept(DEFAULT_SETTINGS, -1);
		expect(resolveUniqueAgentId("opencode-acp", taken)).toBe("opencode-acp-2");
		expect(resolveUniqueAgentId("antigravity-acp", taken)).toBe("antigravity-acp-2");
	});

	it("ChatPanel lists no built-in by hand (only the Kiro check stays)", () => {
		const src = readFileSync(join(__dirname, "../../ui/ChatPanel.tsx"), "utf8");
		expect(src).not.toMatch(/settings\.(claude|codex|gemini|opencode|antigravity)\./);
	});
});

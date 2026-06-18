import { describe, it, expect, vi } from "vitest";
import { normalizeRawSettings, DEFAULT_SETTINGS } from "../settings-normalizer";

/**
 * Behavior-preserving tests for the raw → typed settings mapping extracted
 * from plugin.ts loadSettings (see [[Agent Console Settings Migration]]).
 *
 * The migrateKey callback is stubbed: by default it returns the current
 * secret id unchanged (no migration), mirroring the "already configured"
 * case. Specific tests assert the arguments it receives so the import
 * adapter can rely on the same wiring.
 */

// migrateKey stub: identity on currentSecretId (no migration side-effect).
const idKey = (
	_default: string,
	_fallback: string,
	current: string,
	_legacy: string,
	_label: string,
) => current;

describe("normalizeRawSettings — defaults", () => {
	it("empty raw yields the default agent set + default agent id", () => {
		const s = normalizeRawSettings({}, DEFAULT_SETTINGS, idKey);
		expect(s.claude.id).toBe("claude-code-acp");
		expect(s.claude.command).toBe("claude-agent-acp");
		expect(s.codex.id).toBe("codex-acp");
		expect(s.gemini.id).toBe("gemini-cli");
		expect(s.gemini.args).toEqual(["--experimental-acp"]);
		expect(s.kiro.id).toBe("kiro-cli");
		expect(s.customAgents).toEqual([]);
		expect(s.defaultAgentId).toBe("claude-code-acp");
	});

	it("leaves fork-only fields at defaults regardless of source", () => {
		const s = normalizeRawSettings({}, DEFAULT_SETTINGS, idKey);
		expect(s.restoreTabsOnStartup).toBe(true);
		expect(s.perLeafTabStates).toBeUndefined();
		expect(s.legacySessionsMigrated).toBe(false);
		expect(s.settingsImportOfferShown).toBe(false);
		expect(s.savedSessions).toEqual([]);
		expect(s.lastUsedModels).toEqual({});
		expect(s.lastUsedModes).toEqual({});
	});

	it("never copies the fork-fixed agent id from raw", () => {
		const s = normalizeRawSettings(
			{ claude: { id: "test-spoofed", command: "x" } },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.claude.id).toBe("claude-code-acp");
		expect(s.claude.command).toBe("x");
	});
});

describe("normalizeRawSettings — legacy field migrations", () => {
	it("claudeCodeAcpCommandPath → claude.command", () => {
		const s = normalizeRawSettings(
			{ claudeCodeAcpCommandPath: "/usr/local/bin/claude" },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.claude.command).toBe("/usr/local/bin/claude");
	});

	it("geminiCommandPath → gemini.command", () => {
		const s = normalizeRawSettings(
			{ geminiCommandPath: "/opt/gemini" },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.gemini.command).toBe("/opt/gemini");
	});

	it("new command wins over legacy command path", () => {
		const s = normalizeRawSettings(
			{
				claude: { command: "/new/claude" },
				claudeCodeAcpCommandPath: "/old/claude",
			},
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.claude.command).toBe("/new/claude");
	});

	it("activeAgentId → defaultAgentId (validated against available ids)", () => {
		const s = normalizeRawSettings(
			{ activeAgentId: "codex-acp" },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.defaultAgentId).toBe("codex-acp");
	});

	it("invalid defaultAgentId falls back to the first available id", () => {
		const s = normalizeRawSettings(
			{ defaultAgentId: "test-missing" },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.defaultAgentId).toBe("claude-code-acp");
	});

	it("autoMentionActiveNote → activeNoteAsDefaultContext", () => {
		const s = normalizeRawSettings(
			{ autoMentionActiveNote: false },
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.activeNoteAsDefaultContext).toBe(false);
	});
});

describe("normalizeRawSettings — secret-key wiring (migrateKey)", () => {
	it("invokes migrateKey per credentialed agent with the expected ids", () => {
		const spy = vi.fn(
			(
				_d: string,
				_f: string,
				current: string,
				_l: string,
				_label: string,
			) => current,
		);
		normalizeRawSettings({}, DEFAULT_SETTINGS, spy);
		const labels = spy.mock.calls.map((c) => c[4]);
		expect(labels).toEqual(["Claude", "Codex", "Gemini"]); // not Kiro (no key)
		expect(spy).toHaveBeenCalledWith(
			"claude-api-key",
			"agent-client-claude-api-key",
			"",
			"",
			"Claude",
		);
		expect(spy).toHaveBeenCalledWith(
			"openai-api-key",
			"agent-client-openai-api-key",
			"",
			"",
			"Codex",
		);
		expect(spy).toHaveBeenCalledWith(
			"gemini-api-key",
			"agent-client-gemini-api-key",
			"",
			"",
			"Gemini",
		);
	});

	it("passes a source plaintext apiKey through to migrateKey (legacy path)", () => {
		const spy = vi.fn(() => "claude-api-key");
		const s = normalizeRawSettings(
			{ claude: { apiKey: "sk-plaintext" } },
			DEFAULT_SETTINGS,
			spy,
		);
		expect(spy).toHaveBeenCalledWith(
			"claude-api-key",
			"agent-client-claude-api-key",
			"",
			"sk-plaintext",
			"Claude",
		);
		expect(s.claude.apiKeySecretId).toBe("claude-api-key");
	});

	it("passes a source apiKeySecretId through as currentSecretId (by-reference path)", () => {
		const spy = vi.fn((_d: string, _f: string, current: string) => current);
		const s = normalizeRawSettings(
			{ gemini: { apiKeySecretId: "my-shared-gemini-key" } },
			DEFAULT_SETTINGS,
			spy,
		);
		expect(spy).toHaveBeenCalledWith(
			"gemini-api-key",
			"agent-client-gemini-api-key",
			"my-shared-gemini-key",
			"",
			"Gemini",
		);
		expect(s.gemini.apiKeySecretId).toBe("my-shared-gemini-key");
	});
});

describe("normalizeRawSettings — custom agents", () => {
	it("normalizes and de-duplicates custom agent ids", () => {
		const s = normalizeRawSettings(
			{
				customAgents: [
					{ id: "x", command: "a" },
					{ id: "x", command: "b" },
				],
			},
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.customAgents.map((a) => a.id)).toEqual(["x", "x-2"]);
	});

	it("a valid custom agent id can be the default", () => {
		const s = normalizeRawSettings(
			{
				customAgents: [{ id: "custom-mine", command: "c" }],
				defaultAgentId: "custom-mine",
			},
			DEFAULT_SETTINGS,
			idKey,
		);
		expect(s.defaultAgentId).toBe("custom-mine");
	});
});

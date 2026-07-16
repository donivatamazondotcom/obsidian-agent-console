/**
 * Unit tests for resolveSessionIdForSave (I59).
 *
 * I59: after restore, a tab's live session is lazy (null until first
 * keystroke), but its prior sessionId is persisted. The tab-persistence
 * save must NOT overwrite the persisted id with null — otherwise the next
 * reload can't load message history and the tab restores with title only.
 * The save resolves to the live id, falling back to the persisted id.
 */

import { describe, it, expect } from "vitest";
import {
	resolveSessionIdForSave,
	resolveRenamedSessionWrite,
	resolveCwdForAgent,
} from "../session-helpers";
import type { SavedSessionInfo } from "../../types/session";
import type { AgentClientPluginSettings } from "../../plugin";

describe("resolveSessionIdForSave (I59)", () => {
	it("falls back to the persisted id when the live id is null (restored, pre-reconnect)", () => {
		expect(resolveSessionIdForSave(null, "sess-A")).toBe("sess-A");
	});

	it("uses the live id when present (acquisition / reconnect wins over persisted)", () => {
		expect(resolveSessionIdForSave("live-B", "sess-A")).toBe("live-B");
	});

	it("does not persist a fresh eager session before it has messages", () => {
		expect(resolveSessionIdForSave("live-eager", null, false)).toBeNull();
	});

	it("persists a fresh eager session after its first message", () => {
		expect(resolveSessionIdForSave("live-eager", null, true)).toBe(
			"live-eager",
		);
	});
	it("returns null when neither is present (fresh tab never sent a message)", () => {
		expect(resolveSessionIdForSave(null, null)).toBe(null);
	});
});

describe("resolveRenamedSessionWrite (I73)", () => {
	const NOW = "2026-06-20T05:00:00.000Z";
	const saved: SavedSessionInfo = {
		sessionId: "sess-A",
		agentId: "claude",
		cwd: "/vault",
		title: "Old derived title",
		createdAt: "2026-06-19T00:00:00.000Z",
		updatedAt: "2026-06-19T00:00:00.000Z",
	};

	it("writes the new title for a restored tab whose live id is null but persisted id matches (the I73 bug)", () => {
		// Pre-fix handleRenameTab read the live map only -> null -> skipped
		// the saveSession write, so the rename was lost from history.
		const result = resolveRenamedSessionWrite(
			null, // live id — restored tab not yet reconnected
			"sess-A", // persisted id
			[saved],
			"TPA scheduling",
			NOW,
		);
		expect(result).toEqual({
			...saved,
			title: "TPA scheduling",
			updatedAt: NOW,
		});
	});

	it("writes the new title using the live id when present (reconnected tab)", () => {
		const result = resolveRenamedSessionWrite(
			"sess-A",
			null,
			[saved],
			"Reconnected rename",
			NOW,
		);
		expect(result).toEqual({
			...saved,
			title: "Reconnected rename",
			updatedAt: NOW,
		});
	});

	it("returns null when the tab has no resolvable session (fresh tab, never messaged)", () => {
		expect(
			resolveRenamedSessionWrite(null, null, [saved], "X", NOW),
		).toBeNull();
	});

	it("returns null when no saved session matches the resolved id (nothing in history to sync)", () => {
		expect(
			resolveRenamedSessionWrite(null, "sess-UNKNOWN", [saved], "X", NOW),
		).toBeNull();
	});
});

describe("resolveCwdForAgent (I131)", () => {
	const VAULT = "/Users/me/vault";
	const AGENT_DIR = "/Users/me/repos/claude-work";
	const GLOBAL_DIR = "/Users/me/repos/global-work";

	// Minimal settings shape consumed by findAgentSettings +
	// resolveAgentWorkingDirectory. Per-agent + global defaults are the only
	// fields under test; the rest is cast through unknown.
	function makeSettings(opts: {
		claudeDir?: string;
		globalDir?: string;
	}): AgentClientPluginSettings {
		return {
			claude: { id: "claude", defaultWorkingDirectory: opts.claudeDir },
			codex: { id: "codex" },
			gemini: { id: "gemini" },
			kiro: { id: "kiro" },
			opencode: { id: "opencode-acp" },
			customAgents: [],
			defaultAgentId: "claude",
			defaultWorkingDirectory: opts.globalDir ?? "",
		} as unknown as AgentClientPluginSettings;
	}

	// Hermetic existence predicate — every configured dir "exists".
	const existsAll = () => true;

	it("returns the agent's configured dir when valid (source: agent)", () => {
		const settings = makeSettings({
			claudeDir: AGENT_DIR,
			globalDir: GLOBAL_DIR,
		});
		const r = resolveCwdForAgent(settings, "claude", VAULT, existsAll);
		expect(r).toEqual({ dir: AGENT_DIR, source: "agent", fellBack: false });
	});

	it("falls back to the global default when the agent dir is unset (source: global)", () => {
		const settings = makeSettings({ globalDir: GLOBAL_DIR });
		const r = resolveCwdForAgent(settings, "claude", VAULT, existsAll);
		expect(r).toEqual({
			dir: GLOBAL_DIR,
			source: "global",
			fellBack: false,
		});
	});

	it("falls back to the vault root when neither agent nor global dir is set (source: vault)", () => {
		const settings = makeSettings({});
		const r = resolveCwdForAgent(settings, "claude", VAULT, existsAll);
		expect(r).toEqual({ dir: VAULT, source: "vault", fellBack: false });
	});

	it("treats an unknown agentId as having no per-agent default (uses global)", () => {
		const settings = makeSettings({
			claudeDir: AGENT_DIR,
			globalDir: GLOBAL_DIR,
		});
		const r = resolveCwdForAgent(
			settings,
			"no-such-agent",
			VAULT,
			existsAll,
		);
		expect(r).toEqual({
			dir: GLOBAL_DIR,
			source: "global",
			fellBack: false,
		});
	});

	it("switching agents resolves to the NEW agent's dir, not the old one's (the I131 behavior)", () => {
		// codex has no configured dir → a switch from claude (AGENT_DIR) to
		// codex must resolve to the global default, NOT stay at AGENT_DIR.
		const settings = makeSettings({
			claudeDir: AGENT_DIR,
			globalDir: GLOBAL_DIR,
		});
		const r = resolveCwdForAgent(settings, "codex", VAULT, existsAll);
		expect(r.dir).toBe(GLOBAL_DIR);
		expect(r.dir).not.toBe(AGENT_DIR);
	});
});

/**
 * I270: the server-session cache is keyed by launch, read and written only
 * through `server-session-cache.ts`, and validated at the settings edge.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	readServerSessionCache,
	withServerSessionCache,
} from "../server-session-cache";
import {
	DEFAULT_SETTINGS,
	normalizeAgentCapabilityCache,
	normalizeRawSettings,
} from "../settings-normalizer";

const norm = (raw: Record<string, unknown>) =>
	normalizeRawSettings(raw, DEFAULT_SETTINGS, (_d: string, _f: string, current: string) => current);
import type { AgentCapabilities } from "../../types/session";

const entry = {
	sessions: [{ sessionId: "sess_1", cwd: "/v", title: "A", updatedAt: "2026-11-06T00:00:00Z" }],
	syncedAt: "2026-11-06T00:00:00Z",
};

afterEach(() => vi.restoreAllMocks());

describe("server-session cache accessors", () => {
	it("reads only the entry for the given launch", () => {
		const settings = { serverSessionCache: { "v3|kiro-cli": entry } };
		expect(readServerSessionCache(settings, "v3|kiro-cli")).toBe(entry);
		expect(readServerSessionCache(settings, "v2|kiro-cli")).toBeNull();
		expect(readServerSessionCache(settings, null)).toBeNull();
	});

	it("writes under the launch key and leaves other launches alone", () => {
		const other = { sessions: [], syncedAt: "2026-11-01T00:00:00Z" };
		const next = withServerSessionCache({ "v2|claude": other }, "v3|kiro-cli", entry);
		expect(next).toEqual({ "v2|claude": other, "v3|kiro-cli": entry });
	});
});

describe("settings edge (I270)", () => {
	const LISTS: AgentCapabilities = {
		listsSessions: true,
		restoresViaLoad: true,
		restoresViaResume: false,
		forks: true,
		closesSessions: true,
		reportsModels: true,
	};
	const learnedAt = "2026-11-01T00:00:00Z";

	it("drops a malformed server-session entry and keeps a good one", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const s = norm({
			serverSessionCache: {
				"v3|kiro-cli": entry,
				"v2|claude": { sessions: "nope", syncedAt: 3 },
			},
		});
		expect(s.serverSessionCache).toEqual({ "v3|kiro-cli": entry });
		expect(warn).toHaveBeenCalled();
	});

	it("ignores the old agent-id-keyed cache", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const s = norm({
			agentSessionMetaCache: { "kiro-cli": entry },
		});
		expect(s.serverSessionCache).toEqual({});
		expect("agentSessionMetaCache" in s).toBe(false);
	});

	it("drops a pinned Kiro V2 capability entry that claims to list; keeps the rest", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const out = normalizeAgentCapabilityCache({
			"v2|kiro-cli": { capabilities: LISTS, learnedAt },
			"v2|/Users/me/.local/bin/kiro-cli": { capabilities: LISTS, learnedAt },
			"v3|kiro-cli": { capabilities: LISTS, learnedAt },
			"v2|claude-code-acp": { capabilities: LISTS, learnedAt },
			"v2|kiro-cli-chat": {
				capabilities: { ...LISTS, listsSessions: false },
				learnedAt,
			},
		});
		expect(Object.keys(out).sort()).toEqual(
			["v2|claude-code-acp", "v2|kiro-cli-chat", "v3|kiro-cli"].sort(),
		);
	});
});

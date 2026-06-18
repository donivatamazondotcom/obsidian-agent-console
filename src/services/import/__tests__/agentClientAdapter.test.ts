import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { createAgentClientAdapter } from "../agentClientAdapter";
import type { MigrateKeyFn } from "../../settings-normalizer";

/**
 * Tests for the agent-client import adapter — see [[Agent Console Settings
 * Migration]] T1–T5. A fake App exposes only the surfaces the adapter touches
 * (vault.adapter.exists/read, vault.configDir, secretStorage). The real key
 * migrator is mirrored from plugin.migrateLegacyApiKey (minus Notices) against
 * the fake secret store.
 */

function makeApp(
	dataJson: string | null,
	secrets: Record<string, string> = {},
): { app: App; store: Record<string, string> } {
	const store: Record<string, string> = { ...secrets };
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (_p: string) => dataJson !== null),
				read: vi.fn(async (_p: string) => {
					if (dataJson === null) throw new Error("ENOENT");
					return dataJson;
				}),
			},
		},
		secretStorage: {
			getSecret: (id: string) => (id in store ? store[id] : null),
			setSecret: (id: string, v: string) => {
				store[id] = v;
			},
			listSecrets: () => Object.keys(store),
		},
	} as unknown as App;
	return { app, store };
}

/** Mirrors plugin.migrateLegacyApiKey (minus Notices) against the fake store. */
function makeMigrateKey(app: App): MigrateKeyFn {
	return (defaultId, fallbackId, currentId, legacy) => {
		if (currentId) return currentId;
		const t = legacy.trim();
		if (!t) return "";
		const existing = app.secretStorage.getSecret(defaultId);
		if (existing === null) {
			app.secretStorage.setSecret(defaultId, t);
			return defaultId;
		}
		if (existing === t) return defaultId;
		app.secretStorage.setSecret(fallbackId, t);
		return fallbackId;
	};
}

function makeAdapter(
	dataJson: string | null,
	secrets: Record<string, string> = {},
) {
	const { app, store } = makeApp(dataJson, secrets);
	const adapter = createAgentClientAdapter({
		app,
		migrateKey: makeMigrateKey(app),
	});
	return { adapter, app, store };
}

describe("agentClientAdapter — detect (T1) + fail-soft (T4)", () => {
	it("detects a present, parseable data.json", async () => {
		const { adapter } = makeAdapter(JSON.stringify({ claude: {} }));
		expect(await adapter.detect()).toBe(true);
	});

	it("returns false / null when the source data.json is absent", async () => {
		const { adapter } = makeAdapter(null);
		expect(await adapter.detect()).toBe(false);
		expect(await adapter.preview()).toBeNull();
	});

	it("fails soft on malformed JSON (no throw)", async () => {
		const { adapter } = makeAdapter("{ not valid json ");
		await expect(adapter.detect()).resolves.toBe(false);
		await expect(adapter.preview()).resolves.toBeNull();
	});

	it("fails soft when data.json is a non-object", async () => {
		const { adapter } = makeAdapter("[1,2,3]");
		expect(await adapter.detect()).toBe(false);
	});
});

describe("agentClientAdapter — preview key status", () => {
	it("by-reference when the secret resolves in this vault", async () => {
		const { adapter } = makeAdapter(
			JSON.stringify({ gemini: { apiKeySecretId: "gemini-api-key" } }),
			{ "gemini-api-key": "secret-value" },
		);
		const p = await adapter.preview();
		expect(p!.agents.find((a) => a.key === "gemini")!.keyStatus).toBe(
			"by-reference",
		);
	});

	it("needs-relink when the referenced secret is absent", async () => {
		const { adapter } = makeAdapter(
			JSON.stringify({ gemini: { apiKeySecretId: "gemini-api-key" } }),
		);
		const p = await adapter.preview();
		expect(p!.agents.find((a) => a.key === "gemini")!.keyStatus).toBe(
			"needs-relink",
		);
	});

	it("will-migrate-plaintext for a legacy plaintext apiKey", async () => {
		const { adapter } = makeAdapter(
			JSON.stringify({ claude: { apiKey: "sk-plain" } }),
		);
		const p = await adapter.preview();
		expect(p!.agents.find((a) => a.key === "claude")!.keyStatus).toBe(
			"will-migrate-plaintext",
		);
	});

	it("none when no key material is present", async () => {
		const { adapter } = makeAdapter(
			JSON.stringify({ codex: { command: "/x" } }),
		);
		const p = await adapter.preview();
		expect(p!.agents.find((a) => a.key === "codex")!.keyStatus).toBe(
			"none",
		);
	});

	it("preview is side-effect free (writes no secrets)", async () => {
		const { adapter, store } = makeAdapter(
			JSON.stringify({ claude: { apiKey: "sk-plain" } }),
		);
		await adapter.preview();
		expect(Object.keys(store)).toEqual([]);
	});
});

describe("agentClientAdapter — apply: secret by reference (T2)", () => {
	it("ports apiKeySecretId without re-linking or new writes", async () => {
		const { adapter, store } = makeAdapter(
			JSON.stringify({ gemini: { apiKeySecretId: "gemini-api-key" } }),
			{ "gemini-api-key": "secret-value" },
		);
		const slice = await adapter.apply((await adapter.preview())!);
		expect(slice.gemini!.apiKeySecretId).toBe("gemini-api-key");
		expect(Object.keys(store)).toEqual(["gemini-api-key"]); // no new writes
		expect(JSON.stringify(slice)).not.toContain("secret-value"); // value never surfaced
	});
});

describe("agentClientAdapter — apply: legacy plaintext (T3)", () => {
	it("migrates plaintext apiKey into secretStorage and references it", async () => {
		const { adapter, store } = makeAdapter(
			JSON.stringify({ claude: { apiKey: "sk-plain" } }),
		);
		const slice = await adapter.apply((await adapter.preview())!);
		expect(slice.claude!.apiKeySecretId).toBe("claude-api-key");
		expect(store["claude-api-key"]).toBe("sk-plain");
	});

	it("falls back to a prefixed id on secret collision (preserves the other key)", async () => {
		const { adapter, store } = makeAdapter(
			JSON.stringify({ claude: { apiKey: "sk-mine" } }),
			{ "claude-api-key": "someone-elses-key" },
		);
		const slice = await adapter.apply((await adapter.preview())!);
		expect(slice.claude!.apiKeySecretId).toBe(
			"agent-client-claude-api-key",
		);
		expect(store["agent-client-claude-api-key"]).toBe("sk-mine");
		expect(store["claude-api-key"]).toBe("someone-elses-key");
	});
});

describe("agentClientAdapter — apply: fork-only fields untouched (T5)", () => {
	it("omits fork-only fields so the caller merge preserves them", async () => {
		const { adapter } = makeAdapter(
			JSON.stringify({
				claude: { command: "/c" },
				kiro: { command: "/k" },
				savedSessions: [{ junk: true }],
				perLeafTabStates: [{ junk: true }],
			}),
		);
		const slice = await adapter.apply((await adapter.preview())!);
		for (const forkOnly of [
			"kiro",
			"restoreTabsOnStartup",
			"perLeafTabStates",
			"savedSessions",
			"lastUsedModels",
			"lastUsedModes",
			"migrationNoticeShown",
			"legacySessionsMigrated",
		]) {
			expect(forkOnly in slice).toBe(false);
		}
		expect(slice.claude!.command).toBe("/c"); // configured agent IS imported
	});
});

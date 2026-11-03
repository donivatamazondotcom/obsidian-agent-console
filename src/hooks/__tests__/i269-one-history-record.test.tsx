/**
 * I269 — one chat keeps one history record across every fallback
 * ([[I269 A fallback leaves two history entries for one chat]]).
 *
 * Before the fix, `savedSessions` records were keyed by the agent's session
 * id. A fallback mints a new agent id, so the next turn save found no record
 * and created a second one, titled from the transcript's first message.
 *
 * Seams (R2):
 * - `useLazySession`: the real acquisition owner. Its fallback report is
 *   wired the way ChatPanel wires it (rebind the record, then arm the
 *   carry-over, which the I246/I265 suites cover).
 * - `useSessionHistory`: the real hook every tab save goes through.
 * - `SessionStore` + `SessionStorage`: the real single writer and the real
 *   store. Only the Obsidian vault adapter and the settings snapshot are
 *   in-memory fakes (R4).
 *
 * Assertions are on the persisted `savedSessions` array, the message files on
 * disk and the history list the modal renders (R3). Expected values are
 * literals (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";

import { useLazySession, type UseLazySessionOptions } from "../useLazySession";
import { reloadResultToAcquisition } from "../reloadSessionFlow";
import { useSessionHistory } from "../useSessionHistory";
import { SessionStorage } from "../../services/session-storage";
import { SessionStore } from "../../services/session-store";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type { ChatSession, SavedSessionInfo } from "../../types/session";
import type { ChatMessage } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";
import {
	buildTabIdentitySignature,
	resolveRecordIdForSave,
} from "../../services/session-helpers";
import type { AgentClientPluginSettings } from "../../plugin";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function msg(role: "user" | "assistant", text: string, id: string): ChatMessage {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		timestamp: new Date("2026-11-02T10:00:00Z"),
	};
}

const REMEMBER_7: ChatMessage[] = [
	msg("user", "Remember the number 7.", "u1"),
	msg("assistant", "Got it, I will remember 7.", "a1"),
];
const AFTER_FALLBACK: ChatMessage[] = [
	...REMEMBER_7,
	msg("user", "What number did I ask you to remember?", "u2"),
	msg("assistant", "7.", "a2"),
];
const OTHER_CHAT: ChatMessage[] = [
	msg("user", "Plan the Q3 offsite.", "o1"),
	msg("assistant", "Sure.", "o2"),
];

const SESSIONS_DIR = ".obsidian/plugins/agent-console/sessions";
const fileOf = (id: string) => `${SESSIONS_DIR}/${id}.json`;

/** A migrated (pre-I269) record: its record id is its first agent id. */
const ORIGINAL: SavedSessionInfo = {
	recordId: "sess-x",
	sessionId: "sess-x",
	agentId: "kiro",
	cwd: "/vault",
	title: "Number memory test",
	createdAt: "2026-11-02T09:00:00.000Z",
	updatedAt: "2026-11-02T09:05:00.000Z",
};

// ---------------------------------------------------------------------------
// Real store over an in-memory vault + settings snapshot
// ---------------------------------------------------------------------------

function makeStore(seed: SavedSessionInfo[] = []) {
	const files = new Map<string, string>();
	let state = {
		savedSessions: seed,
	} as unknown as AgentClientPluginSettings;
	const adapter = {
		exists: vi.fn(async (p: string) => files.has(p) || p === SESSIONS_DIR),
		mkdir: vi.fn(async () => {}),
		read: vi.fn(async (p: string) => {
			const v = files.get(p);
			if (v === undefined) throw new Error(`ENOENT ${p}`);
			return v;
		}),
		write: vi.fn(async (p: string, data: string) => {
			files.set(p, data);
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
	};
	const plugin = {
		app: { vault: { configDir: ".obsidian", adapter } },
		manifest: { id: "agent-console" },
	} as unknown as AgentClientPlugin;
	const snapshotAccess = {
		getSnapshot: () => state,
		updateSettings: async (u: Partial<AgentClientPluginSettings>) => {
			state = { ...state, ...u };
		},
	};
	const storage = new SessionStorage(plugin, snapshotAccess);
	/** When > 0, metadata writes are dropped (a quit before they land). */
	let dropMetadataWrites = 0;
	const facade = {
		getSnapshot: () => state,
		updateSettings: snapshotAccess.updateSettings,
		subscribe: () => () => {},
		getSavedSessions: (agentId?: string, cwd?: string) =>
			storage.getSavedSessions(agentId, cwd),
		saveSession: async (info: SavedSessionInfo) => {
			if (dropMetadataWrites > 0) {
				dropMetadataWrites--;
				return;
			}
			await storage.saveSession(info);
		},
		deleteSession: (id: string) => storage.deleteSession(id),
		saveSessionMessages: (
			...args: Parameters<SessionStorage["saveSessionMessages"]>
		) => storage.saveSessionMessages(...args),
		loadSessionMessages: (sessionId: string, recordId?: string | null) =>
			(
				storage.loadSessionMessages as (
					s: string,
					r?: string | null,
				) => Promise<ChatMessage[] | null>
			)(sessionId, recordId),
		loadSessionContextNotes: (sessionId: string, recordId?: string | null) =>
			(
				storage.loadSessionContextNotes as (
					s: string,
					r?: string | null,
				) => Promise<unknown>
			)(sessionId, recordId),
	} as Record<string, unknown>;
	facade.sessionStore = new SessionStore(
		facade as unknown as ConstructorParameters<typeof SessionStore>[0],
	);
	return {
		settings: facade as unknown as ISettingsAccess,
		storage,
		files,
		records: () => state.savedSessions,
		setRecords: (r: SavedSessionInfo[]) => {
			state = { ...state, savedSessions: r };
		},
		dropNextMetadataWrite: () => {
			dropMetadataWrites = 1;
		},
		messagesIn: (id: string): number | null => {
			const raw = files.get(fileOf(id));
			return raw ? (JSON.parse(raw) as { messages: unknown[] }).messages.length : null;
		},
	};
}

type Store = ReturnType<typeof makeStore>;

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// One tab: the lazy owner + the history hook, wired as ChatPanel wires them
// ---------------------------------------------------------------------------

type HistoryWithBinding = ReturnType<typeof useSessionHistory> & {
	rebindRecord?: (sessionId: string, kiroEngine?: "v2" | "v3") => void;
	resetRecordBinding?: () => void;
	getRecordId?: () => string | null;
};

function mountTab(
	store: Store,
	opts: {
		restoredSessionId?: string;
		restoredRecordId?: string | null;
		agentId?: string;
		lazy?: Partial<UseLazySessionOptions>;
		/** Every record-binding report the tab makes to ChatView. */
		reports?: Array<string | null>;
	} = {},
) {
	const agentId = opts.agentId ?? "kiro";
	return renderHook(() => {
		const historyRef = useRef<HistoryWithBinding | null>(null);
		const lazy = useLazySession({
			acquireNewSession: vi
				.fn()
				.mockResolvedValue({ ok: true, sessionId: "new-1" }),
			loadExistingSession: vi.fn().mockResolvedValue({
				ok: true,
				sessionId: opts.restoredSessionId ?? "loaded-1",
			}),
			sendPrompt: vi.fn().mockResolvedValue(undefined),
			debounceMs: 0,
			restoredSessionId: opts.restoredSessionId,
			...opts.lazy,
			// ChatPanel: rebind the record to the new agent session, then arm
			// the carry-over (covered by the I246 / I265 suites).
			onSessionFallback: ((_reason: unknown, sessionId?: string) => {
				if (sessionId) historyRef.current?.rebindRecord?.(sessionId);
			}) as UseLazySessionOptions["onSessionFallback"],
			onReset: () => historyRef.current?.resetRecordBinding?.(),
		});
		const session = {
			sessionId: lazy.sessionId,
			agentId,
			state: "ready",
			authMethods: [],
			capabilities: {
				listsSessions: false,
				restoresViaLoad: true,
				restoresViaResume: false,
				forks: false,
				closesSessions: false,
				reportsModels: false,
			},
		} as unknown as ChatSession;
		const history = useSessionHistory({
			agentClient: { getLaunchKey: () => null } as unknown as AcpClient,
			session,
			settingsAccess: store.settings,
			agentCwd: "/vault",
			onSessionLoad: vi.fn(),
			restoredSessionId: opts.restoredSessionId ?? null,
			restoredRecordId: opts.restoredRecordId ?? null,
			onRecordIdChange: (id: string | null) => opts.reports?.push(id),
		} as Parameters<typeof useSessionHistory>[0]) as HistoryWithBinding;
		historyRef.current = history;
		return { lazy, history };
	});
}

type Tab = ReturnType<typeof mountTab>;

async function send(tab: Tab, text: string) {
	await act(async () => {
		tab.result.current.lazy.onSendClick(text);
	});
	await waitFor(() => expect(tab.result.current.lazy.state).toBe("ready"));
}

async function turnSave(
	tab: Tab,
	messages: ChatMessage[],
	suggestedTitle?: string,
) {
	await act(async () => {
		const sid = tab.result.current.lazy.sessionId;
		if (!sid) throw new Error("no live session to save");
		await tab.result.current.history.saveSessionMessages(
			sid,
			messages,
			undefined,
			suggestedTitle,
		);
		await settle();
	});
}

/** What the tab writes to `perLeafTabStates` (sessionId + recordId). */
function persistedTab(tab: Tab) {
	return {
		sessionId: tab.result.current.lazy.sessionId,
		recordId: tab.result.current.history.getRecordId?.() ?? null,
	};
}

/** Restored tab whose load fails, so it falls back to a new session. */
function failingLoad(reason?: "engine-changed") {
	return vi.fn().mockResolvedValue({
		ok: false,
		error: new Error("Session not found"),
		...(reason ? { fallbackReason: reason } : {}),
	});
}

/** The full I269 contract after one fallback on the original record. */
async function expectOneRecordAfterFallback(store: Store, newId: string) {
	const records = store.records();
	expect(records).toHaveLength(1);
	expect(records[0]).toMatchObject({
		recordId: "sess-x",
		sessionId: newId,
		title: "Number memory test",
		agentId: "kiro",
		cwd: "/vault",
	});
	// The transcript lives under the record id.
	expect(store.messagesIn("sess-x")).toBe(4);
	expect(store.messagesIn(newId)).toBeNull();
}

async function seededStore() {
	const store = makeStore([ORIGINAL]);
	await store.storage.saveSessionMessages("sess-x", "kiro", REMEMBER_7);
	return store;
}

// ---------------------------------------------------------------------------
// 1. Every fallback path keeps one record
// ---------------------------------------------------------------------------

describe("I269 — a fallback keeps one history record", () => {
	it("failed load: one record, original title, new session id, restores after restart", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: { loadExistingSession: failingLoad() },
		});
		await send(tab, "What number did I ask you to remember?");
		await turnSave(tab, AFTER_FALLBACK);
		await expectOneRecordAfterFallback(store, "new-1");

		// Restart: the tab restores from what it persisted.
		const saved = persistedTab(tab);
		expect(saved).toEqual({ sessionId: "new-1", recordId: "sess-x" });
		const restored = await store.settings.loadSessionMessages(
			saved.sessionId!,
			saved.recordId,
		);
		expect(restored?.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);

		// The history list (what the modal renders) has one row.
		const reopened = mountTab(store, {
			restoredSessionId: saved.sessionId!,
			restoredRecordId: saved.recordId,
		});
		await act(async () => {
			await reopened.result.current.history.fetchSessions("local");
		});
		expect(
			reopened.result.current.history.sessions.map((s) => s.title),
		).toEqual(["Number memory test"]);
	});

	it("engine change: one record", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: { loadExistingSession: failingLoad("engine-changed") },
		});
		await send(tab, "What number did I ask you to remember?");
		await turnSave(tab, AFTER_FALLBACK);
		await expectOneRecordAfterFallback(store, "new-1");
	});

	it("empty load (I264, reported as a failed load): one record", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: {
				loadExistingSession: vi.fn().mockResolvedValue({
					ok: false,
					error: new Error("Empty load"),
				}),
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "empty-new" }),
			},
		});
		await send(tab, "What number did I ask you to remember?");
		await turnSave(tab, AFTER_FALLBACK);
		await expectOneRecordAfterFallback(store, "empty-new");
	});

	it("soft reload that starts fresh: one record", async () => {
		const store = await seededStore();
		const tab = mountTab(store, { restoredSessionId: "sess-x" });
		await send(tab, "hi");
		expect(tab.result.current.lazy.sessionId).toBe("sess-x");
		await act(async () => {
			await tab.result.current.lazy.reloadNow(async () =>
				reloadResultToAcquisition({
					resumed: false,
					reason: "resume-failed",
					sessionId: "fresh-2",
				}),
			);
		});
		await turnSave(tab, AFTER_FALLBACK);
		await expectOneRecordAfterFallback(store, "fresh-2");
	});

	it("quit after the fallback, before any send: the tab still restores", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: { loadExistingSession: failingLoad() },
		});
		await send(tab, "What number did I ask you to remember?");
		await settle();
		// No turn save. The tab persisted the new id.
		const saved = persistedTab(tab);
		expect(saved.sessionId).toBe("new-1");
		const restored = await store.settings.loadSessionMessages(
			saved.sessionId!,
			saved.recordId,
		);
		expect(restored?.map((m) => m.id)).toEqual(["u1", "a1"]);
		expect(store.records()).toHaveLength(1);
		expect(store.records()[0]?.sessionId).toBe("new-1");
	});
});

// ---------------------------------------------------------------------------
// 2. Paths that must not merge or move records
// ---------------------------------------------------------------------------

describe("I269 — negative and guard cases", () => {
	it("a real load keeps one record and its id", async () => {
		const store = await seededStore();
		const tab = mountTab(store, { restoredSessionId: "sess-x" });
		await send(tab, "What number did I ask you to remember?");
		await turnSave(tab, AFTER_FALLBACK);
		expect(store.records()).toHaveLength(1);
		expect(store.records()[0]).toMatchObject({
			recordId: "sess-x",
			sessionId: "sess-x",
			title: "Number memory test",
		});
	});

	it("New chat after a restore starts a new record", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "chat-2" }),
			},
		});
		await send(tab, "hi");
		act(() => tab.result.current.lazy.reset());
		await send(tab, "Plan the Q3 offsite.");
		await turnSave(tab, OTHER_CHAT);
		const records = store.records();
		expect(records).toHaveLength(2);
		const original = records.find((r) => r.sessionId === "sess-x");
		const fresh = records.find((r) => r.sessionId === "chat-2");
		expect(original?.title).toBe("Number memory test");
		expect(fresh?.title).toBe("Plan the Q3 offsite.");
		expect(fresh?.recordId).not.toBe("sess-x");
		expect(store.messagesIn("sess-x")).toBe(2);
	});

	it("regression guard: a local fork gets exactly one record of its own", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "fork-1" }),
			},
		});
		await send(tab, "x");
		// forkExistingSession's eager persist, then the turn save.
		await turnSave(tab, REMEMBER_7, "Fork: Number memory test");
		act(() => tab.result.current.history.rebindRecord?.("fork-1"));
		await turnSave(tab, AFTER_FALLBACK);
		const records = store.records();
		expect(records).toHaveLength(2);
		expect(records.find((r) => r.sessionId === "sess-x")?.title).toBe(
			"Number memory test",
		);
		expect(records.find((r) => r.sessionId === "fork-1")?.title).toBe(
			"Fork: Number memory test",
		);
		expect(store.messagesIn("sess-x")).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 3. Cases added by the design review
// ---------------------------------------------------------------------------

describe("I269 — design-review cases", () => {
	it("H1: the abandoned agent id restored in a second tab never shares the record", async () => {
		const store = await seededStore();
		const first = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: { loadExistingSession: failingLoad() },
		});
		await send(first, "What number did I ask you to remember?");
		await turnSave(first, AFTER_FALLBACK);

		// The agent still lists sess-x; the user opens it in a new tab.
		expect(await store.settings.loadSessionMessages("sess-x")).toBeNull();
		const second = mountTab(store, { restoredSessionId: "sess-x" });
		await send(second, "Plan the Q3 offsite.");
		await turnSave(second, OTHER_CHAT);

		const records = store.records();
		expect(records).toHaveLength(2);
		const a = records.find((r) => r.recordId === "sess-x");
		expect(a?.sessionId).toBe("new-1");
		expect(store.messagesIn("sess-x")).toBe(4);
		const b = records.find((r) => r.sessionId === "sess-x");
		expect(b?.recordId).not.toBe("sess-x");
	});

	it("H2: the message file lands but the record write is lost; the tab still restores", async () => {
		const store = makeStore();
		const tab = mountTab(store, {
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "s-1" }),
			},
		});
		await send(tab, "Remember the number 7.");
		store.dropNextMetadataWrite();
		await turnSave(tab, REMEMBER_7);
		expect(store.records()).toHaveLength(0);
		const saved = persistedTab(tab);
		expect(saved.recordId).toBeTruthy();

		const reopened = mountTab(store, {
			restoredSessionId: saved.sessionId!,
			restoredRecordId: saved.recordId,
		});
		const restored = await store.settings.loadSessionMessages(
			saved.sessionId!,
			saved.recordId,
		);
		expect(restored?.map((m) => m.id)).toEqual(["u1", "a1"]);
		await send(reopened, "What number?");
		await turnSave(reopened, AFTER_FALLBACK);
		expect(store.records()).toHaveLength(1);
		expect(store.records()[0]?.recordId).toBe(saved.recordId);
	});

	it("H2: a restart after a rebind but before the tab-state save still restores", async () => {
		const store = makeStore();
		const first = mountTab(store, {
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "s-1" }),
			},
		});
		await send(first, "Remember the number 7.");
		await turnSave(first, REMEMBER_7);
		const before = persistedTab(first);

		// Restored, the load fails, the record is rebound to f-1 ...
		const second = mountTab(store, {
			restoredSessionId: before.sessionId!,
			restoredRecordId: before.recordId,
			lazy: {
				loadExistingSession: failingLoad(),
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "f-1" }),
			},
		});
		await send(second, "What number?");
		await settle();
		expect(store.records()[0]?.sessionId).toBe("f-1");

		// ... and Obsidian quits before the tab state is written again.
		const restored = await store.settings.loadSessionMessages(
			before.sessionId!,
			before.recordId,
		);
		expect(restored?.map((m) => m.id)).toEqual(["u1", "a1"]);
	});

	it("H3: agent-only restore, history rename, then a turn save: one record", async () => {
		const store = makeStore();
		const tab = mountTab(store, { restoredSessionId: "agent-9" });
		await send(tab, "hi");
		await act(async () => {
			await tab.result.current.history.updateSessionTitle(
				"agent-9",
				"Renamed in history",
				"/vault",
			);
			await settle();
		});
		await turnSave(tab, REMEMBER_7);
		const records = store.records();
		expect(records).toHaveLength(1);
		expect(records[0]?.title).toBe("Renamed in history");
		expect(store.messagesIn(records[0]!.recordId)).toBe(2);
	});

	it("H4: renaming another agent's row keeps that row's agent", async () => {
		const claude: SavedSessionInfo = {
			recordId: "rec-claude",
			sessionId: "claude-1",
			agentId: "claude-code-acp",
			cwd: "/vault",
			title: "Claude chat",
			createdAt: "2026-11-01T00:00:00.000Z",
			updatedAt: "2026-11-01T00:00:00.000Z",
		};
		const store = makeStore([claude]);
		const kiroTab = mountTab(store, { agentId: "kiro" });
		await act(async () => {
			await kiroTab.result.current.history.updateSessionTitle(
				"claude-1",
				"Claude chat, renamed",
				"/vault",
			);
			await settle();
		});
		expect(store.records()).toEqual([
			{ ...claude, title: "Claude chat, renamed", updatedAt: expect.any(String) },
		]);
	});

	it("M1: a tab rename right after a fallback renames the one record", async () => {
		const store = await seededStore();
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			lazy: { loadExistingSession: failingLoad() },
		});
		await send(tab, "What number did I ask you to remember?");
		await settle();
		// ChatView.applyTabRename: the tab's record id when it has one.
		await act(async () => {
			await store.settings.sessionStore.renameSession({
				recordId: tab.result.current.history.getRecordId?.() ?? null,
				sessionId: "new-1",
				agentId: "kiro",
				cwd: "",
				title: "Renamed tab",
				createIfMissing: false,
			});
			await settle();
		});
		await turnSave(tab, AFTER_FALLBACK);
		const records = store.records();
		expect(records).toHaveLength(1);
		expect(records[0]?.title).toBe("Renamed tab");
	});

	it("M3: a bound record that was evicted is recreated under the same id", async () => {
		const store = makeStore();
		const tab = mountTab(store, {
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "s-1" }),
			},
		});
		await send(tab, "Remember the number 7.");
		await turnSave(tab, REMEMBER_7);
		const recordId = store.records()[0]?.recordId;
		expect(recordId).toBeTruthy();
		store.setRecords([]);
		await turnSave(tab, AFTER_FALLBACK);
		expect(store.records()).toHaveLength(1);
		expect(store.records()[0]?.recordId).toBe(recordId);
		expect(store.messagesIn(recordId!)).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// 4. Cases added by the code review (what ChatView persists)
// ---------------------------------------------------------------------------

describe("I269 — code-review cases", () => {
	/** ChatView's persisted record id for a tab: the report wins once made. */
	function persistedRecordId(
		reports: Array<string | null>,
		restored: string | null,
	): string {
		return resolveRecordIdForSave(
			{ has: reports.length > 0, id: reports.at(-1) ?? null },
			restored,
		);
	}

	it("a reset in a restored tab never persists the old chat's record id", async () => {
		const store = await seededStore();
		const reports: Array<string | null> = [];
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			restoredRecordId: "sess-x",
			reports,
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "chat-2" }),
			},
		});
		await send(tab, "hi");
		expect(persistedRecordId(reports, "sess-x")).toBe("sess-x");

		// Hard reload / New chat / agent switch all reset the lazy owner.
		act(() => tab.result.current.lazy.reset());
		expect(persistedRecordId(reports, "sess-x")).toBe("");
		await send(tab, "Plan the Q3 offsite.");
		await turnSave(tab, OTHER_CHAT);

		const fresh = persistedRecordId(reports, "sess-x");
		expect(fresh).not.toBe("sess-x");
		expect(store.records().find((r) => r.recordId === fresh)?.sessionId).toBe(
			"chat-2",
		);
		// The old chat is untouched: same session, same transcript.
		expect(store.records().find((r) => r.recordId === "sess-x")).toMatchObject({
			sessionId: "sess-x",
			title: "Number memory test",
		});
		expect(store.messagesIn("sess-x")).toBe(2);
	});

	it("a tab rename after a reset leaves the old chat's title alone", async () => {
		const store = await seededStore();
		const reports: Array<string | null> = [];
		const tab = mountTab(store, {
			restoredSessionId: "sess-x",
			restoredRecordId: "sess-x",
			reports,
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "chat-2" }),
			},
		});
		await send(tab, "hi");
		act(() => tab.result.current.lazy.reset());
		await send(tab, "x");
		// ChatView.applyTabRename.
		await act(async () => {
			await store.settings.sessionStore.renameSession({
				recordId: persistedRecordId(reports, "sess-x") || null,
				sessionId: "chat-2",
				agentId: "kiro",
				cwd: "",
				title: "New tab name",
				createIfMissing: false,
			});
			await settle();
		});
		expect(store.records().find((r) => r.recordId === "sess-x")?.title).toBe(
			"Number memory test",
		);
	});

	it("minting a record id changes the tab-state signature, so it is saved", async () => {
		const store = makeStore();
		const reports: Array<string | null> = [];
		const tab = mountTab(store, {
			reports,
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "s-1" }),
			},
		});
		await send(tab, "Remember the number 7.");
		const sessions = new Map([["T1", "s-1"]]);
		const before = buildTabIdentitySignature(
			sessions,
			new Map([["T1", reports.at(-1) ?? null]]),
		);
		store.dropNextMetadataWrite();
		await turnSave(tab, REMEMBER_7);
		const minted = reports.at(-1);
		expect(minted).toBeTruthy();
		const after = buildTabIdentitySignature(
			sessions,
			new Map([["T1", minted ?? null]]),
		);
		expect(after).not.toBe(before);
	});

	it("a turn save that adopts another record writes the transcript under that record", async () => {
		const store = makeStore();
		const reports: Array<string | null> = [];
		const tab = mountTab(store, {
			reports,
			lazy: {
				acquireNewSession: vi
					.fn()
					.mockResolvedValue({ ok: true, sessionId: "s-1" }),
			},
		});
		await send(tab, "Remember the number 7.");
		await turnSave(tab, REMEMBER_7);
		const minted = reports.at(-1)!;
		// Elsewhere, the tab's record goes away and another record for the
		// same agent session appears (an Agent-row rename with createIfMissing).
		store.setRecords([
			{
				recordId: "rec-q",
				sessionId: "s-1",
				agentId: "kiro",
				cwd: "/vault",
				title: "Renamed elsewhere",
				createdAt: "2026-11-03T00:00:00.000Z",
				updatedAt: "2026-11-03T00:00:00.000Z",
			},
		]);
		await turnSave(tab, AFTER_FALLBACK);
		expect(store.records()).toHaveLength(1);
		expect(store.records()[0]?.title).toBe("Renamed elsewhere");
		expect(reports.at(-1)).toBe("rec-q");
		expect(store.messagesIn("rec-q")).toBe(4);
		expect(minted).not.toBe("rec-q");
	});
});

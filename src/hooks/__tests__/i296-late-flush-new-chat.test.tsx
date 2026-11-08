/**
 * I296 — a late flush after New chat can bind the new chat to the old record
 * ([[I296 A late flush after New chat can bind the new chat to the old record]]).
 *
 * After `clearMessages`, `useDebouncedSessionSave` still holds the old chat's
 * unsaved snapshot. A later flush (quit, tab close, idle release) calls
 * `saveSessionMessages(oldSessionId, …)` after the reset, so `bindRecordId`
 * binds the NEW chat to the old record (or to a fresh id holding the old
 * transcript), and the new chat's first save writes over the old transcript.
 *
 * Seams (R2): the real `useSessionHistory` (binding owner, `resetRecordBinding`
 * is what `useLazySession.reset` → `onReset` calls), the real
 * `useDebouncedSessionSave` and its public `flushPending` / unmount flush, the
 * real `SessionStore` + `SessionStorage`. Fakes only at the declared
 * boundaries (R4): the ACP client port, the Obsidian adapter (in-memory disk)
 * and the settings snapshot. Messages enter as the hook props ChatPanel passes.
 *
 * Assertions (R3): the persisted `savedSessions`, the message files on disk,
 * and the binding the tab persists (`onRecordIdChange`). Literals only (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSessionHistory } from "../useSessionHistory";
import { useDebouncedSessionSave } from "../useDebouncedSessionSave";
import { SessionStorage } from "../../services/session-storage";
import { SessionStore } from "../../services/session-store";
import type { ISettingsAccess } from "../../services/settings-service";
import type { AcpClient } from "../../acp/acp-client";
import type { ChatSession, SavedSessionInfo } from "../../types/session";
import type { ChatMessage } from "../../types/chat";
import type AgentClientPlugin from "../../plugin";
import type { AgentClientPluginSettings } from "../../plugin";

const SESSIONS_DIR = ".obsidian/plugins/agent-console/sessions";
const fileOf = (id: string) => `${SESSIONS_DIR}/${id}.json`;
/** Debounce for the incremental save in this harness (ChatPanel uses 1000). */
const DEBOUNCE_MS = 20;

async function settle(ms = 0) {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
	if (ms) await new Promise((r) => setTimeout(r, ms));
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function msg(role: "user" | "assistant", text: string, id: string): ChatMessage {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		timestamp: new Date("2026-11-08T10:00:00Z"),
	};
}

const OLD_Q = msg("user", "Old chat question ALPHA", "u1");
const OLD_A = msg("assistant", "Old chat answer ALPHA", "a1");
const NEW_Q = msg("user", "New chat question BETA", "u2");

// ---------------------------------------------------------------------------
// Real store over an in-memory vault + settings snapshot
// ---------------------------------------------------------------------------

function makeStore(seed: SavedSessionInfo[] = []) {
	const files = new Map<string, string>();
	let sessionWrites = 0;
	let state = {
		savedSessions: seed,
		titleStrategy: "prompt-derived",
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
			if (p.startsWith(SESSIONS_DIR)) sessionWrites++;
			files.set(p, data);
		}),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
		trashSystem: vi.fn(async (p: string) => (files.delete(p), true)),
		trashLocal: vi.fn(async (p: string) => {
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
	const facade = {
		getSnapshot: () => state,
		updateSettings: snapshotAccess.updateSettings,
		subscribe: () => () => {},
		getSavedSessions: (agentId?: string, cwd?: string) =>
			storage.getSavedSessions(agentId, cwd),
		saveSession: (info: SavedSessionInfo) => storage.saveSession(info),
		deleteSession: (id: string) => storage.deleteSession(id),
		deleteSessionMessages: (id: string) => storage.deleteSessionMessages(id),
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
	} as Record<string, unknown>;
	const sessionStore = new SessionStore(
		facade as unknown as ConstructorParameters<typeof SessionStore>[0],
	);
	facade.sessionStore = sessionStore;
	return {
		settings: facade as unknown as ISettingsAccess,
		records: () => state.savedSessions,
		/** Message-file writes so far. */
		sessionWrites: () => sessionWrites,
		/** Message texts in a record's transcript file, or null if none. */
		transcript: (recordId: string): string[] | null => {
			const raw = files.get(fileOf(recordId));
			if (raw === undefined) return null;
			const parsed = JSON.parse(raw) as { messages: ChatMessage[] };
			return parsed.messages.map((m) =>
				m.content
					.map((c) => ("text" in c ? (c as { text: string }).text : ""))
					.join(""),
			);
		},
	};
}

type Store = ReturnType<typeof makeStore>;

// ---------------------------------------------------------------------------
// One tab: history binding + debounced save, wired as ChatPanel wires them
// ---------------------------------------------------------------------------

type Props = { sessionId: string | null; messages: ChatMessage[] };

function mountTab(store: Store, initial: Props) {
	const agentClient = {
		sendPrompt: vi.fn(),
		getLaunchKey: () => null,
	} as unknown as AcpClient;
	const bindings: (string | null)[] = [];
	const onRecordIdChange = (id: string | null) => bindings.push(id);

	const hook = renderHook(
		({ sessionId, messages }: Props) => {
			const session = {
				sessionId,
				agentId: "kiro",
				state: "ready",
				authMethods: [],
				promptCapabilities: { embeddedContext: false },
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
				agentClient,
				session,
				settingsAccess: store.settings,
				agentCwd: "/vault",
				onSessionLoad: vi.fn(),
				restoredSessionId: null,
				restoredRecordId: null,
				onRecordIdChange,
			} as Parameters<typeof useSessionHistory>[0]);
			const { flushPending } = useDebouncedSessionSave(
				sessionId,
				messages,
				[],
				history.saveSessionMessages,
				history.registerPendingFlush,
				DEBOUNCE_MS,
				DEBOUNCE_MS,
			);
			return { history, flushPending };
		},
		{ initialProps: initial },
	);
	return { ...hook, bindings, lastBinding: () => bindings[bindings.length - 1] };
}

/**
 * New chat as ChatPanel runs it: `clearMessages` (messages → []), then the
 * lazy reset (`onReset` → `resetRecordBinding`, session id → null).
 */
function newChat(h: ReturnType<typeof mountTab>) {
	h.rerender({ sessionId: "sess-1", messages: [] });
	act(() => h.result.current.history.resetRecordBinding());
	h.rerender({ sessionId: null, messages: [] });
}

/** The old chat saved once (record + file), then got an unsaved reply. */
async function oldChatWithDirtyTail(store: Store) {
	const h = mountTab(store, { sessionId: "sess-1", messages: [OLD_Q] });
	await settle(DEBOUNCE_MS * 3);
	expect(store.records()).toHaveLength(1);
	const oldRecordId = store.records()[0].recordId;
	// The reply lands; New chat comes before the debounce fires.
	h.rerender({ sessionId: "sess-1", messages: [OLD_Q, OLD_A] });
	return { h, oldRecordId };
}

describe("I296: a late flush after New chat never binds the new chat", () => {
	it("quit flush (flushPending) after New chat: the new chat stays unbound", async () => {
		const store = makeStore();
		const { h } = await oldChatWithDirtyTail(store);

		newChat(h);
		await act(() => h.result.current.flushPending());
		await settle(DEBOUNCE_MS * 3);

		expect(h.lastBinding()).toBeNull();
		expect(h.result.current.history.getRecordId()).toBeNull();
	});

	it("tab close (unmount flush) after New chat: the persisted binding is none", async () => {
		const store = makeStore();
		const { h } = await oldChatWithDirtyTail(store);

		newChat(h);
		h.unmount();
		await settle(DEBOUNCE_MS * 3);

		expect(h.lastBinding()).toBeNull();
	});

	it("flush after New chat, then a send: two records, the old transcript intact", async () => {
		const store = makeStore();
		const { h, oldRecordId } = await oldChatWithDirtyTail(store);

		newChat(h);
		// Idle release / any flush that runs before the new chat's first message.
		await act(() => h.result.current.flushPending());
		await settle(DEBOUNCE_MS * 3);
		h.rerender({ sessionId: "sess-2", messages: [NEW_Q] });
		await settle(DEBOUNCE_MS * 3);

		expect(store.transcript(oldRecordId)).toEqual([
			"Old chat question ALPHA",
			"Old chat answer ALPHA",
		]);
		expect(store.records()).toHaveLength(2);
		const newRecord = store.records().find((r) => r.sessionId === "sess-2");
		expect(newRecord?.recordId).not.toBe(oldRecordId);
		expect(store.transcript(newRecord!.recordId)).toEqual([
			"New chat question BETA",
		]);
		expect(h.result.current.history.getRecordId()).toBe(newRecord!.recordId);
	});

	it("old chat never saved before New chat: its tail lands in its own record", async () => {
		const store = makeStore();
		// First message only, New chat before the first debounced save.
		const h = mountTab(store, { sessionId: "sess-1", messages: [OLD_Q] });

		newChat(h);
		await act(() => h.result.current.flushPending());
		await settle(DEBOUNCE_MS * 3);
		h.rerender({ sessionId: "sess-2", messages: [NEW_Q] });
		await settle(DEBOUNCE_MS * 3);

		const oldRecord = store.records().find((r) => r.sessionId === "sess-1");
		const newRecord = store.records().find((r) => r.sessionId === "sess-2");
		expect(store.records()).toHaveLength(2);
		expect(store.transcript(oldRecord!.recordId)).toEqual([
			"Old chat question ALPHA",
		]);
		expect(newRecord!.recordId).not.toBe(oldRecord!.recordId);
		expect(store.transcript(newRecord!.recordId)).toEqual([
			"New chat question BETA",
		]);
	});

	it("regression guard: a flush with no New chat keeps the tail and the binding", async () => {
		const store = makeStore();
		const { h, oldRecordId } = await oldChatWithDirtyTail(store);

		await act(() => h.result.current.flushPending());
		await settle(DEBOUNCE_MS * 3);

		expect(store.records()).toHaveLength(1);
		expect(store.transcript(oldRecordId)).toEqual([
			"Old chat question ALPHA",
			"Old chat answer ALPHA",
		]);
		expect(h.lastBinding()).toBe(oldRecordId);
	});

	it("reset with nothing pending writes nothing", async () => {
		const store = makeStore();
		const h = mountTab(store, { sessionId: "sess-1", messages: [OLD_Q] });
		await settle(DEBOUNCE_MS * 3);
		const before = store.sessionWrites();

		newChat(h);
		await settle(DEBOUNCE_MS * 3);

		expect(store.sessionWrites()).toBe(before);
		expect(h.lastBinding()).toBeNull();
	});
});

describe("I296: the flush slot on the binding owner", () => {
	function mountHistory(store: Store) {
		const bindings: (string | null)[] = [];
		const session = {
			sessionId: "sess-1",
			agentId: "kiro",
			state: "ready",
			authMethods: [],
			promptCapabilities: { embeddedContext: false },
			capabilities: {
				listsSessions: false,
				restoresViaLoad: true,
				restoresViaResume: false,
				forks: false,
				closesSessions: false,
				reportsModels: false,
			},
		} as unknown as ChatSession;
		const h = renderHook(() =>
			useSessionHistory({
				agentClient: { getLaunchKey: () => null } as unknown as AcpClient,
				session,
				settingsAccess: store.settings,
				agentCwd: "/vault",
				onSessionLoad: vi.fn(),
				restoredSessionId: null,
				restoredRecordId: null,
				onRecordIdChange: (id: string | null) => bindings.push(id),
			} as Parameters<typeof useSessionHistory>[0]),
		);
		return { h, bindings };
	}

	it("a flush that throws still resets the binding; the next save mints a new record", async () => {
		const store = makeStore();
		const { h, bindings } = mountHistory(store);
		await act(() =>
			h.result.current.saveSessionMessages("sess-1", [OLD_Q, OLD_A]),
		);
		await settle();
		const oldRecordId = store.records()[0].recordId;
		h.result.current.registerPendingFlush(() => {
			throw new Error("boom");
		});

		act(() => h.result.current.resetRecordBinding());
		expect(bindings[bindings.length - 1]).toBeNull();

		await act(() => h.result.current.saveSessionMessages("sess-2", [NEW_Q]));
		await settle();
		expect(store.records()).toHaveLength(2);
		expect(store.transcript(oldRecordId)).toEqual([
			"Old chat question ALPHA",
			"Old chat answer ALPHA",
		]);
	});

	it("an old unregister doesn't clear a newer flush; a cleared slot calls nothing", () => {
		const store = makeStore();
		const { h } = mountHistory(store);
		const first = vi.fn(() => false);
		const second = vi.fn(() => false);
		const unregisterFirst = h.result.current.registerPendingFlush(first);
		const unregisterSecond = h.result.current.registerPendingFlush(second);

		unregisterFirst();
		act(() => h.result.current.resetRecordBinding());
		expect(first).toHaveBeenCalledTimes(0);
		expect(second).toHaveBeenCalledTimes(1);

		unregisterSecond();
		act(() => h.result.current.resetRecordBinding());
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("a reset after the debounced save unmounted calls no stale flush", async () => {
		const store = makeStore();
		const { h } = await oldChatWithDirtyTail(store);
		const history = h.result.current.history;
		h.unmount(); // its unmount flush writes the tail
		await settle(DEBOUNCE_MS * 3);
		const before = store.sessionWrites();

		act(() => history.resetRecordBinding());
		await settle(DEBOUNCE_MS * 3);

		expect(store.sessionWrites()).toBe(before);
	});
});

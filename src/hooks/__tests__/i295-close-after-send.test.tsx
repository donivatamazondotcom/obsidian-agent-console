/**
 * I295 — closing a tab right after a send leaves a history record with no
 * transcript ([[I295 Closing a tab right after a send leaves a history record with no transcript]]).
 *
 * Before the fix, `handleSendMessage` awaited the whole turn and then called
 * `saveSessionLocally`, whose `recordFirstMessage` CREATED a record with no
 * transcript. A close in the same tick as Enter unmounts the tab before the
 * user message reaches React state, so nothing ever writes the file.
 *
 * Seams (R2): the real `useAgentMessages` (its `addMessage` sits behind the
 * selection read and `preparePrompt`), the real `useChatActions` send path,
 * the real `useSessionHistory` and `useDebouncedSessionSave`, the real
 * `SessionStore` + `SessionStorage`. Fakes only at the declared boundaries
 * (R4): the ACP client port (`sendPrompt`), the vault port (`readNote`, held
 * to pin the prepare window), the Obsidian adapter and the settings snapshot.
 *
 * Assertions (R3): the persisted `savedSessions` array, the message files on
 * the in-memory disk (record ⇔ file, the INV-3 rule) and the hook's message
 * state. Expected values are literals (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useAgentMessages } from "../useAgentMessages";
import { useChatActions } from "../useChatActions";
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

type Params = Parameters<typeof useChatActions>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepMock(overrides: Record<string, unknown> = {}): unknown {
	const cache: Record<string, unknown> = { ...overrides };
	return new Proxy(function () {}, {
		get(_t, p: string | symbol) {
			if (typeof p === "symbol") return undefined;
			if (!(p in cache)) cache[p] = deepMock();
			return cache[p];
		},
		apply: () => undefined,
	});
}

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

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

const SESSIONS_DIR = ".obsidian/plugins/agent-console/sessions";
const fileOf = (id: string) => `${SESSIONS_DIR}/${id}.json`;
const SEND_TEXT = "Reply with only the word BETA.";
/** Debounce for the incremental save in this harness (ChatPanel uses 1000). */
const DEBOUNCE_MS = 20;

// ---------------------------------------------------------------------------
// Real store over an in-memory vault + settings snapshot
// ---------------------------------------------------------------------------

function makeStore(seed: SavedSessionInfo[] = []) {
	const files = new Map<string, string>();
	let failSessionWrites = false;
	/** Session-file writes still to fail (one-shot, after any hold). */
	let failNext = 0;
	let fileGate: Promise<void> | null = null;
	/** Index (among session-file writes from now) of the one write held. */
	let holdIndex = -1;
	let holdGate: Promise<void> | null = null;
	let metadataGate: Promise<void> | null = null;
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
			if (p.startsWith(SESSIONS_DIR)) {
				if (fileGate) await fileGate;
				if (holdIndex >= 0) {
					const mine = holdIndex--;
					if (mine === 0 && holdGate) await holdGate;
				}
				if (failNext > 0) {
					failNext--;
					throw new Error(`EIO ${p}`);
				}
				if (failSessionWrites) throw new Error(`EIO ${p}`);
			}
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
		saveSession: async (info: SavedSessionInfo) => {
			if (metadataGate) await metadataGate;
			await storage.saveSession(info);
		},
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
		sessionStore,
		files,
		records: () => state.savedSessions,
		failSessionWrites: () => {
			failSessionWrites = true;
		},
		holdFiles: () => {
			const d = deferred();
			fileGate = d.promise;
			return () => {
				fileGate = null;
				d.resolve();
			};
		},
		/** Fail the next `n` session-file writes that reach the disk check. */
		failNextSessionWrites: (n: number) => {
			failNext = n;
		},
		/** Hold only the session-file write after the next `pass` ones. */
		holdFileWriteAfter: (pass: number) => {
			const d = deferred();
			holdIndex = pass;
			holdGate = d.promise;
			return () => {
				holdGate = null;
				d.resolve();
			};
		},
		holdMetadata: () => {
			const d = deferred();
			metadataGate = d.promise;
			return () => {
				metadataGate = null;
				d.resolve();
			};
		},
		/** Record ids whose message file is missing (the INV-3 rule). */
		recordsWithoutFile: () =>
			state.savedSessions
				.filter((r) => !files.has(fileOf(r.recordId)))
				.map((r) => r.recordId),
	};
}

type Store = ReturnType<typeof makeStore>;

// ---------------------------------------------------------------------------
// One tab: send path + history + debounced save, wired as ChatPanel wires them
// ---------------------------------------------------------------------------

function mountChat(
	store: Store,
	opts: {
		sessionId?: string;
		/** The tab's persisted record id (from tab state). */
		restoredRecordId?: string;
		/** The agent's answer to session/prompt. */
		prompt?: () => Promise<unknown>;
		/** Held vault read for the selection (pins the prepare window). */
		readNote?: () => Promise<string>;
	} = {},
) {
	const sendPrompt = vi.fn(
		opts.prompt ?? (() => Promise.resolve({ stopKind: "end_turn" })),
	);
	const setErrorInfo = vi.fn();
	const agentClient = {
		sendPrompt,
		getLaunchKey: () => null,
	} as unknown as AcpClient;
	const vaultAccess = deepMock({
		readNote: vi.fn(opts.readNote ?? (async () => "line one\nline two")),
	}) as Parameters<typeof useAgentMessages>[2];
	const session = {
		sessionId: opts.sessionId ?? "sess-1",
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
	const plugin = deepMock({
		settings: { hasCompletedSetup: true },
		app: deepMock({
			metadataCache: deepMock({ getFirstLinkpathDest: () => null }),
		}),
	}) as Params[0];
	const selection = opts.readNote
		? { path: "Note.md", fromLine: 0, toLine: 0 }
		: null;

	const hook = renderHook(() => {
		const msgs = useAgentMessages(
			agentClient,
			store.settings,
			vaultAccess,
			session,
			setErrorInfo,
		);
		const history = useSessionHistory({
			agentClient,
			session,
			settingsAccess: store.settings,
			agentCwd: "/vault",
			onSessionLoad: vi.fn(),
			restoredSessionId: null,
			restoredRecordId: opts.restoredRecordId ?? null,
		} as Parameters<typeof useSessionHistory>[0]);
		const agent = deepMock({
			clearError: vi.fn(),
			sendMessage: msgs.sendMessage,
			messages: msgs.messages,
			isSending: msgs.isSending,
			session,
		}) as Params[1];
		const actions = useChatActions(
			plugin,
			agent,
			history,
			deepMock() as Params[3],
			session,
			msgs.messages,
			{ activeNoteAsDefaultContext: false } as unknown as Params[6],
			"",
			{ notes: [], add: vi.fn(), markHydrated: vi.fn() } as unknown as Params[8],
			selection,
			null,
			false,
			{ current: null } as Params[12],
		);
		const { flushPending } = useDebouncedSessionSave(
			session.sessionId,
			msgs.messages,
			[],
			history.saveSessionMessages,
			DEBOUNCE_MS,
			DEBOUNCE_MS,
		);
		return { msgs, history, actions, flushPending };
	});
	return { ...hook, sendPrompt, setErrorInfo };
}

function send(h: ReturnType<typeof mountChat>, text = SEND_TEXT) {
	let done!: Promise<void>;
	act(() => {
		done = h.result.current.actions.handleSendMessage(text);
	});
	return done;
}

// ---------------------------------------------------------------------------
// The I295 race: close in the same tick as Enter
// ---------------------------------------------------------------------------

describe("I295: a send closed in the same tick leaves no record without a transcript", () => {
	it("prompt rejected after the close: no record, no file", async () => {
		const store = makeStore();
		const read = deferred<string>();
		const h = mountChat(store, {
			readNote: () => read.promise,
			prompt: () => Promise.reject(new Error("connection closed")),
		});

		const done = send(h);
		h.unmount(); // the tab closes before preparePrompt resolves
		read.resolve("line one");
		await done;
		await settle(DEBOUNCE_MS * 3);

		expect(store.recordsWithoutFile()).toEqual([]);
		expect(store.records()).toHaveLength(0);
	});

	it("prompt resolved as cancelled after the close: no record, no file", async () => {
		const store = makeStore();
		const read = deferred<string>();
		const h = mountChat(store, {
			readNote: () => read.promise,
			prompt: () => Promise.resolve({ stopKind: "cancelled" }),
		});

		const done = send(h);
		h.unmount();
		read.resolve("line one");
		await done;
		await settle(DEBOUNCE_MS * 3);

		expect(store.recordsWithoutFile()).toEqual([]);
		expect(store.records()).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// First turns that end before any save
// ---------------------------------------------------------------------------

describe("I295: short first turns still get one record with its file", () => {
	it("sub-second turn: one record, first-message title, file present", async () => {
		const store = makeStore();
		const h = mountChat(store);

		await send(h);
		await settle(DEBOUNCE_MS * 3);

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].title).toBe(SEND_TEXT);
		expect(store.recordsWithoutFile()).toEqual([]);
	});

	it("failed result in the same task: the debounced save is the only writer", async () => {
		const store = makeStore();
		const h = mountChat(store, {
			prompt: () => Promise.reject(new Error("boom")),
		});

		await send(h);
		await settle(DEBOUNCE_MS * 3);

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].title).toBe(SEND_TEXT);
		expect(store.recordsWithoutFile()).toEqual([]);
	});

	it("normal turn (regression guard): one record, title, file", async () => {
		const store = makeStore();
		const turn = deferred<unknown>();
		const h = mountChat(store, { prompt: () => turn.promise });

		const done = send(h);
		await settle(DEBOUNCE_MS * 3);
		turn.resolve({ stopKind: "end_turn" });
		await done;
		await settle(DEBOUNCE_MS * 3);

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].title).toBe(SEND_TEXT);
		expect(store.recordsWithoutFile()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Ordering: the record follows its transcript
// ---------------------------------------------------------------------------

describe("I295: a record is written only after its transcript lands", () => {
	it("no record exists while the first file write is held", async () => {
		const store = makeStore();
		const release = store.holdFiles();
		const h = mountChat(store);

		await send(h);
		await settle(DEBOUNCE_MS * 3);
		expect(store.records()).toHaveLength(0);

		release();
		await settle(DEBOUNCE_MS * 3);
		expect(store.records()).toHaveLength(1);
		expect(store.recordsWithoutFile()).toEqual([]);
	});

	it("a failed file write creates no record", async () => {
		const store = makeStore();
		store.failSessionWrites();
		const h = mountChat(store);

		await send(h);
		await settle(DEBOUNCE_MS * 3);

		expect(store.records()).toHaveLength(0);
	});

	it("a failed file write leaves the tab unbound (no dangling record id)", async () => {
		const store = makeStore();
		store.failSessionWrites();
		const h = mountChat(store);

		await act(async () => {
			await h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
		});
		await settle();

		expect(store.records()).toHaveLength(0);
		expect(h.result.current.history.getRecordId()).toBeNull();
	});

	it("a failed write doesn't unbind while a later save of the same id is in flight", async () => {
		const store = makeStore();
		store.failSessionWrites();
		const h = mountChat(store);
		// Writes interleave (two attempts each): the first three fail and
		// settle save 1; save 2's retry is held, so save 2 is still in flight.
		const release = store.holdFileWriteAfter(3);

		let first!: Promise<void>;
		let second!: Promise<void>;
		act(() => {
			first = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
			second = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
				msg("assistant", "hello", "a1"),
			]);
		});
		let secondDone = false;
		void second.then(() => {
			secondDone = true;
		});
		const minted = h.result.current.history.getRecordId();
		await first;
		await settle();
		expect(secondDone).toBe(false); // the hold really holds save 2
		expect(h.result.current.history.getRecordId()).toBe(minted);

		release();
		await second;
		await settle();
		expect(h.result.current.history.getRecordId()).toBeNull();
	});

	it("a newer save failing while an older one is still writing keeps the binding", async () => {
		const store = makeStore();
		const h = mountChat(store);
		// Save 1's first write is held; save 2's two attempts fail.
		const release = store.holdFileWriteAfter(0);

		let older!: Promise<void>;
		let newer!: Promise<void>;
		act(() => {
			older = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
			store.failNextSessionWrites(2);
			newer = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
				msg("assistant", "hello", "a1"),
			]);
		});
		const minted = h.result.current.history.getRecordId();
		await newer;
		await settle();
		expect(h.result.current.history.getRecordId()).toBe(minted);

		release();
		await older;
		await settle();
		expect(store.records().map((r) => r.recordId)).toEqual([minted]);
		expect(h.result.current.history.getRecordId()).toBe(minted);
		expect(store.recordsWithoutFile()).toEqual([]);
	});

	it("a failed file write leaves an existing record unchanged", async () => {
		const existing: SavedSessionInfo = {
			recordId: "rec-1",
			sessionId: "sess-1",
			agentId: "kiro",
			cwd: "/vault",
			title: "Earlier chat",
			createdAt: "2026-11-08T09:00:00.000Z",
			updatedAt: "2026-11-08T09:00:00.000Z",
		};
		const store = makeStore([existing]);
		store.files.set(fileOf("rec-1"), JSON.stringify({ messages: [] }));
		store.failSessionWrites();
		const h = mountChat(store);

		await act(async () => {
			await h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
		});
		await settle();

		expect(store.records()).toEqual([existing]);
	});

	it("the teardown flush resolves only after the file and the record land", async () => {
		const store = makeStore();
		const turn = deferred<unknown>();
		const h = mountChat(store, { prompt: () => turn.promise });

		void send(h);
		await settle(); // user message in state, debounced save armed
		const releaseMetadata = store.holdMetadata();
		let flushed = false;
		const flush = h.result.current.flushPending().then(() => {
			flushed = true;
		});
		await settle();
		expect(flushed).toBe(false);

		releaseMetadata();
		await flush;
		expect(store.records()).toHaveLength(1);
		expect(store.recordsWithoutFile()).toEqual([]);
		turn.resolve({ stopKind: "end_turn" });
	});
});

// ---------------------------------------------------------------------------
// A reset while a send is still preparing
// ---------------------------------------------------------------------------

describe("I295: New chat while a send is preparing drops that send", () => {
	it("the new chat stays empty and no prompt goes out", async () => {
		const store = makeStore();
		const read = deferred<string>();
		const h = mountChat(store, { readNote: () => read.promise });

		const done = send(h);
		act(() => h.result.current.msgs.clearMessages());
		read.resolve("line one");
		await done;
		await settle(DEBOUNCE_MS * 3);

		expect(h.result.current.msgs.messages).toEqual([]);
		expect(h.sendPrompt).not.toHaveBeenCalled();
		expect(store.records()).toHaveLength(0);
	});

	it("New chat during the stop-settle wait drops the redirect send", async () => {
		const store = makeStore();
		const first = deferred<unknown>();
		let calls = 0;
		const h = mountChat(store, {
			prompt: () => (++calls === 1 ? first.promise : Promise.resolve({})),
		});

		void send(h, "first");
		await settle();
		act(() => h.result.current.msgs.discardPendingTurn());
		let redirect!: Promise<void>;
		act(() => {
			redirect = h.result.current.msgs.sendMessage("redirect", {
				vaultBasePath: "",
			});
		});
		act(() => h.result.current.msgs.clearMessages());
		first.resolve({ stopKind: "cancelled" });
		await redirect;
		await settle();

		expect(h.result.current.msgs.messages).toEqual([]);
		expect(h.sendPrompt).toHaveBeenCalledTimes(1);
	});

	it("a superseded send still goes out: both messages, both prompts", async () => {
		const store = makeStore();
		const read = deferred<string>();
		let reads = 0;
		const h = mountChat(store, {
			readNote: () => (++reads === 1 ? read.promise : Promise.resolve("x")),
		});

		const a = send(h, "first");
		const b = send(h, "second");
		read.resolve("line one");
		await Promise.all([a, b]);
		await settle();

		const userTexts = h.result.current.msgs.messages
			.filter((m) => m.role === "user")
			.map((m) => (m.content[0] as { text: string }).text);
		expect(userTexts.sort()).toEqual(["first", "second"]);
		expect(h.sendPrompt).toHaveBeenCalledTimes(2);
	});

	it("a cancel during prepare keeps the message and sends it", async () => {
		const store = makeStore();
		const read = deferred<string>();
		const h = mountChat(store, { readNote: () => read.promise });

		const done = send(h);
		act(() => h.result.current.msgs.discardPendingTurn());
		read.resolve("line one");
		await done;
		await settle();

		expect(
			h.result.current.msgs.messages.filter((m) => m.role === "user"),
		).toHaveLength(1);
		expect(h.sendPrompt).toHaveBeenCalledTimes(1);
	});

	it("New chat mid-turn: the old turn's late error doesn't land on the new chat", async () => {
		const store = makeStore();
		const turn = deferred<unknown>();
		const h = mountChat(store, { prompt: () => turn.promise });

		const done = send(h);
		await settle();
		act(() => h.result.current.msgs.clearMessages());
		turn.reject(new Error("late failure"));
		await done;
		await settle();

		expect(h.result.current.msgs.isSending).toBe(false);
		expect(h.setErrorInfo).not.toHaveBeenCalledWith(
			expect.objectContaining({ title: expect.any(String) }),
		);
	});
});

// ---------------------------------------------------------------------------
// The tab's record binding across a reset
// ---------------------------------------------------------------------------

describe("I295: a late write after a reset never binds the new chat to the old record", () => {
	it("first-message save after New chat mid-first-turn: binding stays null, old record untouched", async () => {
		const store = makeStore();
		const turn = deferred<unknown>();
		const h = mountChat(store, { prompt: () => turn.promise });

		const done = send(h);
		await settle(DEBOUNCE_MS * 3); // debounced save created the old record
		expect(store.records()).toHaveLength(1);
		const old = { ...store.records()[0] };
		const oldFile = store.files.get(fileOf(old.recordId));

		act(() => {
			h.result.current.msgs.clearMessages();
			h.result.current.history.resetRecordBinding();
		});
		turn.resolve({ stopKind: "cancelled" });
		await done; // saveSessionLocally(old session id) runs now
		await settle();

		expect(h.result.current.history.getRecordId()).toBeNull();
		expect(store.records()).toEqual([old]);
		expect(store.files.get(fileOf(old.recordId))).toBe(oldFile);
	});

	it("reset during a held turn-save write: binding stays null", async () => {
		const store = makeStore();
		const h = mountChat(store);
		const release = store.holdFiles();

		let write!: Promise<void>;
		act(() => {
			write = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
		});
		act(() => h.result.current.history.resetRecordBinding());
		release();
		await write;
		await settle();

		expect(h.result.current.history.getRecordId()).toBeNull();
	});

	it("reset during a held AI-title write: binding stays null", async () => {
		const store = makeStore();
		const h = mountChat(store);
		const release = store.holdMetadata();

		act(() =>
			h.result.current.history.applySessionTitle(
				"sess-1",
				"AI title",
				"/vault",
			),
		);
		act(() => h.result.current.history.resetRecordBinding());
		release();
		await settle();

		expect(h.result.current.history.getRecordId()).toBeNull();
	});

	it("a save that lands after a rebind is healed by the next save", async () => {
		const store = makeStore();
		const h = mountChat(store);
		await act(async () => {
			await h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
		});
		await settle();
		const release = store.holdFiles();
		let late!: Promise<void>;
		act(() => {
			late = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
				msg("assistant", "hello", "a1"),
			]);
		});
		act(() => h.result.current.history.rebindRecord("sess-2"));
		await settle();
		release();
		await late;
		await settle();
		await act(async () => {
			await h.result.current.history.saveSessionMessages("sess-2", [
				msg("user", "hi", "u1"),
				msg("assistant", "hello", "a1"),
			]);
		});
		await settle();

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].sessionId).toBe("sess-2");
		expect(store.recordsWithoutFile()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Other writers that share the turn-save path
// ---------------------------------------------------------------------------

describe("I295: other turn-save callers", () => {
	it("a fork persist creates the record with the fork title, after its file", async () => {
		const store = makeStore();
		const h = mountChat(store, { sessionId: "fork-1" });

		await act(async () => {
			await h.result.current.history.saveSessionMessages(
				"fork-1",
				[msg("user", "hi", "u1"), msg("assistant", "hello", "a1")],
				[],
				"Fork: hi",
			);
		});
		await settle();

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].title).toBe("Fork: hi");
		expect(store.recordsWithoutFile()).toEqual([]);
	});

	it("adopt branch: a record created elsewhere gets the transcript; the minted file is removed", async () => {
		const store = makeStore();
		// The tab is bound to an id no record claims (its own record never
		// landed), so the store adopts the other record for this session.
		const h = mountChat(store, { restoredRecordId: "rec-minted" });
		await store.sessionStore.renameSession({
			recordId: null,
			sessionId: "sess-1",
			agentId: "kiro",
			cwd: "/vault",
			title: "Renamed from history",
			createIfMissing: true,
		});
		const adoptedId = store.records()[0].recordId;
		const files0 = new Set(store.files.keys());

		await act(async () => {
			await h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
		});
		await settle(DEBOUNCE_MS);

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].recordId).toBe(adoptedId);
		expect(store.recordsWithoutFile()).toEqual([]);
		const newFiles = [...store.files.keys()].filter(
			(f) => !files0.has(f) && f.startsWith(SESSIONS_DIR),
		);
		expect(newFiles).toEqual([fileOf(adoptedId)]);
		expect(h.result.current.history.getRecordId()).toBe(adoptedId);
	});

	it("adopt branch: the save resolves only after the adopted copy is on disk", async () => {
		const store = makeStore();
		// The tab is bound to an id no record claims (its own record never
		// landed), so the store adopts the other record for this session.
		const h = mountChat(store, { restoredRecordId: "rec-minted" });
		await store.sessionStore.renameSession({
			recordId: null,
			sessionId: "sess-1",
			agentId: "kiro",
			cwd: "/vault",
			title: "Renamed from history",
			createIfMissing: true,
		});
		const adoptedId = store.records()[0].recordId;
		// The minted file passes; the copy under the adopted id is held.
		const release = store.holdFileWriteAfter(1);

		let saved = false;
		let save!: Promise<void>;
		act(() => {
			save = h.result.current.history
				.saveSessionMessages("sess-1", [msg("user", "hi", "u1")])
				.then(() => {
					saved = true;
				});
		});
		await settle();
		expect(saved).toBe(false);

		release();
		await save;
		expect(store.files.has(fileOf(adoptedId))).toBe(true);
	});

	it("an AI title during a held first file write: one record, AI title kept, file present", async () => {
		const store = makeStore();
		const h = mountChat(store);
		const release = store.holdFiles();

		let write!: Promise<void>;
		act(() => {
			write = h.result.current.history.saveSessionMessages("sess-1", [
				msg("user", "hi", "u1"),
			]);
			h.result.current.history.applySessionTitle("sess-1", "AI title", "/vault");
		});
		await settle();
		release();
		await write;
		await settle();

		expect(store.records()).toHaveLength(1);
		expect(store.records()[0].title).toBe("AI title");
		expect(store.recordsWithoutFile()).toEqual([]);
	});
});

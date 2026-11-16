/**
 * Chat ID — `chat_id` in exported notes, read from the tab's own binding
 * ([[Agent Console Chat ID]] D13), and no binding reports after unmount.
 *
 * - T36: the close-time auto-export of a recorded chat writes its `chat_id`.
 * - T37: an export during the first turn's pending save has no `chat_id`; a
 *   later export of that chat adds it to the same note.
 * - T24 (export half): after a failed transcript write, the export carries no
 *   ID that lacks a record.
 * - T18: a fallback (`rebindRecord`, what ChatPanel's `onSessionFallback`
 *   calls) followed by a re-export updates the same note.
 * - T40: a binding report from an instance that has unmounted (a tab close,
 *   or the old instance after an error-boundary retry) never reaches the tab
 *   state; the mount report still does.
 *
 * Seams (R2): the real `useChatActions` export paths (`autoExportIfEnabled`
 * is what ChatPanel's unmount cleanup and New chat call), the real
 * `useSessionHistory` (the binding owner), `useDebouncedSessionSave`,
 * `SessionStore` + `SessionStorage`, and the real `ChatExporter`. Fakes only
 * at the declared boundaries (R4): the ACP client port, the Obsidian adapter
 * and vault (in-memory), the metadata cache (parses the written notes) and
 * the settings snapshot.
 *
 * Assertions (R3): the exported notes on the fake vault, the persisted
 * records, and the binding reports. Literals where the ID is seeded (R5).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { TFile } from "obsidian";

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

const SESSIONS_DIR = ".obsidian/plugins/agent-console/sessions";
const DEBOUNCE_MS = 20;

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

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function settle(ms = 0) {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
	if (ms) await new Promise((r) => setTimeout(r, ms));
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const T0 = new Date("2026-11-15T10:00:00Z");
function msg(role: "user" | "assistant", text: string, id: string): ChatMessage {
	return { id, role, content: [{ type: "text", text }], timestamp: T0 };
}
const Q = msg("user", "Remember the number 7.", "u1");
const A = msg("assistant", "Got it.", "a1");
const Q2 = msg("user", "What number?", "u2");
const A2 = msg("assistant", "7.", "a2");

const SEEDED: SavedSessionInfo = {
	recordId: "rec-1",
	sessionId: "sess-1",
	agentId: "kiro",
	cwd: "/vault",
	title: "Number memory",
	createdAt: "2026-11-15T09:00:00.000Z",
	updatedAt: "2026-11-15T09:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Real store over an in-memory adapter and settings snapshot
// ---------------------------------------------------------------------------

function makeStore(seed: SavedSessionInfo[] = []) {
	const files = new Map<string, string>();
	let failNext = 0;
	let fileGate: Promise<void> | null = null;
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
				if (failNext > 0) {
					failNext--;
					throw new Error(`EIO ${p}`);
				}
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
		records: () => state.savedSessions,
		failNextSessionWrites: (n: number) => {
			failNext = n;
		},
		holdFiles: () => {
			const d = deferred();
			fileGate = d.promise;
			return () => {
				fileGate = null;
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
	};
}
type Store = ReturnType<typeof makeStore>;

// ---------------------------------------------------------------------------
// The export target: an in-memory vault whose metadata cache reads the notes
// ---------------------------------------------------------------------------

function makeExportVault() {
	const notes = new Map<string, string>();
	const handles = new Map<string, TFile>();
	const handle = (path: string) => {
		let f = handles.get(path);
		if (!f) {
			f = new TFile();
			f.path = path;
			handles.set(path, f);
		}
		return f;
	};
	const vault = deepMock({
		getAbstractFileByPath: (path: string) =>
			notes.has(path) ? handle(path) : null,
		createFolder: async () => {},
		create: async (path: string, content: string) => {
			notes.set(path, content);
			return handle(path);
		},
		modify: async (file: TFile, content: string) => {
			notes.set(file.path, content);
		},
	});
	const metadataCache = deepMock({
		getFirstLinkpathDest: () => null,
		getFileCache: (file: TFile) => {
			const text = notes.get(file.path) ?? "";
			const fm: Record<string, string> = {};
			const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
			for (const line of block.split("\n")) {
				const m = /^(\w+): (.*)$/.exec(line);
				if (m) fm[m[1]] = m[2];
			}
			return { frontmatter: fm };
		},
	});
	const frontmatterOf = (path: string) =>
		/^---\n([\s\S]*?)\n---/.exec(notes.get(path) ?? "")?.[1] ?? "";
	return { notes, vault, metadataCache, frontmatterOf };
}
type ExportVault = ReturnType<typeof makeExportVault>;

// ---------------------------------------------------------------------------
// One tab, wired as ChatPanel wires it
// ---------------------------------------------------------------------------

type Props = { sessionId: string | null; messages: ChatMessage[] };

function sessionOf(sessionId: string | null): ChatSession {
	return {
		sessionId,
		agentId: "kiro",
		agentDisplayName: "Kiro CLI",
		createdAt: T0,
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
}

function mountTab(
	store: Store,
	ev: ExportVault,
	initial: Props,
	opts: { restoredSessionId?: string | null } = {},
) {
	const agentClient = {
		sendPrompt: vi.fn(),
		getLaunchKey: () => null,
	} as unknown as AcpClient;
	const bindings: (string | null)[] = [];
	const plugin = deepMock({
		settings: {
			hasCompletedSetup: true,
			exportSettings: {
				defaultFolder: "Agent Console",
				filenameTemplate: "agent_console_{date}_{time}",
				includeImages: false,
				imageLocation: "obsidian",
				imageCustomFolder: "",
				frontmatterTag: "",
				autoExportOnNewChat: true,
				autoExportOnCloseChat: true,
				openFileAfterExport: false,
			},
		},
		settingsService: store.settings,
		app: deepMock({ vault: ev.vault, metadataCache: ev.metadataCache }),
	}) as Params[0];

	const hook = renderHook(
		({ sessionId, messages }: Props) => {
			const session = sessionOf(sessionId);
			const history = useSessionHistory({
				agentClient,
				session,
				settingsAccess: store.settings,
				agentCwd: "/vault",
				onSessionLoad: vi.fn(),
				restoredSessionId: opts.restoredSessionId ?? null,
				restoredRecordId: null,
				onRecordIdChange: (id: string | null) => bindings.push(id),
			} as Parameters<typeof useSessionHistory>[0]);
			const actions = useChatActions(
				plugin,
				deepMock({ session }) as Params[1],
				history,
				deepMock() as Params[3],
				session,
				messages,
				{ activeNoteAsDefaultContext: false } as unknown as Params[6],
				"",
				{ notes: [], add: vi.fn(), markHydrated: vi.fn() } as unknown as Params[8],
				null,
				null,
				false,
				{ current: null } as Params[12],
			);
			useDebouncedSessionSave(
				sessionId,
				messages,
				[],
				history.saveSessionMessages,
				history.registerPendingFlush,
				DEBOUNCE_MS,
				DEBOUNCE_MS,
			);
			return { history, actions };
		},
		{ initialProps: initial },
	);
	return { ...hook, bindings };
}

async function exportOnClose(
	h: ReturnType<typeof mountTab>,
	sessionId: string,
	messages: ChatMessage[],
) {
	await act(() =>
		h.result.current.actions.autoExportIfEnabled(
			"closeChat",
			messages,
			sessionOf(sessionId),
		),
	);
}

// ---------------------------------------------------------------------------

describe("Chat ID: chat_id in exported notes", () => {
	it("T36: the close-time export of a recorded chat writes its chat_id", async () => {
		const store = makeStore([SEEDED]);
		const ev = makeExportVault();
		const h = mountTab(store, ev, { sessionId: "sess-1", messages: [Q, A] }, {
			restoredSessionId: "sess-1",
		});
		await settle(DEBOUNCE_MS * 3);

		await exportOnClose(h, "sess-1", [Q, A]);

		expect(ev.notes.size).toBe(1);
		const [path] = [...ev.notes.keys()];
		expect(ev.frontmatterOf(path)).toContain("session_id: sess-1\nchat_id: rec-1");
	});

	it("T37: an export during the first turn's pending save has no chat_id; a later export adds it to the same note", async () => {
		const store = makeStore();
		const ev = makeExportVault();
		const release = store.holdMetadata();
		const h = mountTab(store, ev, { sessionId: "sess-1", messages: [] });
		h.rerender({ sessionId: "sess-1", messages: [Q, A] });
		await settle(DEBOUNCE_MS * 3);
		expect(store.records()).toHaveLength(0);

		await exportOnClose(h, "sess-1", [Q, A]);
		const [path] = [...ev.notes.keys()];
		expect(ev.frontmatterOf(path)).not.toContain("chat_id");

		release();
		await settle(DEBOUNCE_MS * 3);
		expect(store.records()).toHaveLength(1);
		const recordId = store.records()[0].recordId;

		await exportOnClose(h, "sess-1", [Q, A]);
		expect([...ev.notes.keys()]).toEqual([path]);
		expect(ev.frontmatterOf(path)).toContain(`chat_id: ${recordId}`);
	});

	it("T24 (export half): after a failed transcript write the export has no chat_id", async () => {
		const store = makeStore();
		const ev = makeExportVault();
		store.failNextSessionWrites(2); // storage retries once
		const h = mountTab(store, ev, { sessionId: "sess-1", messages: [] });
		h.rerender({ sessionId: "sess-1", messages: [Q, A] });
		await settle(DEBOUNCE_MS * 3);
		expect(store.records()).toHaveLength(0);

		await exportOnClose(h, "sess-1", [Q, A]);

		const [path] = [...ev.notes.keys()];
		expect(ev.frontmatterOf(path)).not.toContain("chat_id");
	});

	it("T18: a fallback followed by a re-export updates the same note", async () => {
		const store = makeStore([SEEDED]);
		const ev = makeExportVault();
		const h = mountTab(store, ev, { sessionId: "sess-1", messages: [Q, A] }, {
			restoredSessionId: "sess-1",
		});
		await settle(DEBOUNCE_MS * 3);
		await exportOnClose(h, "sess-1", [Q, A]);
		const [path] = [...ev.notes.keys()];

		// The restore failed and the chat fell back to a new agent session.
		act(() => h.result.current.history.rebindRecord("sess-2"));
		h.rerender({ sessionId: "sess-2", messages: [Q, A, Q2, A2] });
		await settle(DEBOUNCE_MS * 3);
		await exportOnClose(h, "sess-2", [Q, A, Q2, A2]);

		expect([...ev.notes.keys()]).toEqual([path]);
		expect(ev.frontmatterOf(path)).toContain("session_id: sess-2\nchat_id: rec-1");
		expect(store.records()).toHaveLength(1);
	});
});

describe("T40: no binding reports after unmount", () => {
	it("a failed write that unbinds after the tab closed reports nothing; the mount report still arrives", async () => {
		const store = makeStore();
		const ev = makeExportVault();
		const h = mountTab(store, ev, { sessionId: "sess-1", messages: [] });
		expect(h.bindings).toEqual([null]); // the mount report

		const release = store.holdFiles();
		store.failNextSessionWrites(2); // storage retries once
		h.rerender({ sessionId: "sess-1", messages: [Q, A] });
		await settle(DEBOUNCE_MS * 3);
		const minted = h.result.current.history.getRecordId();
		expect(minted).not.toBeNull();
		expect(h.bindings).toEqual([null, minted]);

		h.unmount();
		release();
		await settle(DEBOUNCE_MS * 3);

		// The internal binding moved (writes and binding are unchanged)...
		expect(h.result.current.history.getRecordId()).toBeNull();
		// ...but the closed tab reported nothing after unmount.
		expect(h.bindings).toEqual([null, minted]);
	});
});

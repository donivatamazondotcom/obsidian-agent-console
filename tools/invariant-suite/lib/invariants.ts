/**
 * Invariant probe definitions for the in-Obsidian invariant suite.
 *
 * Each invariant encodes a standing behavior that has regressed at least
 * once (the mapped Ixx class) and is probeable in a RUNNING Obsidian via
 * CDP `Runtime.evaluate` — the layer jsdom unit tests structurally cannot
 * reach (real workspace focus, keymap scope stack, plugin data on disk).
 *
 * Probes must be safe against a disposable smoke vault (studio / ST-*):
 * read-only where possible; any state they create (e.g. a new chat tab)
 * must be inconsequential in a vault with no precious sessions. The
 * runner refuses non-smoke vaults for this reason (see run.ts).
 *
 * Spec: vault note "Verification Overhaul" (Pillar 3).
 */
import type { Cdp } from "../../screenshots/lib/cdp";

export type InvariantStatus = "pass" | "fail" | "skip" | "todo";

export interface InvariantResult {
	id: string;
	name: string;
	/** The regression class this guards (public PR refs live in the repo history). */
	guards: string;
	status: InvariantStatus;
	detail: string;
}

export interface Invariant {
	id: string;
	name: string;
	guards: string;
	run(cdp: Cdp): Promise<{ status: InvariantStatus; detail: string }>;
}

const PLUGIN_ID = "agent-console";
const VIEW_TYPE = "agent-console-chat-view";

/** Wrap a page-side IIFE so it returns a JSON string we can parse. */
function pageJson(body: string): string {
	return `JSON.stringify((() => { ${body} })())`;
}

async function evalJson<T>(cdp: Cdp, body: string): Promise<T> {
	const raw = await cdp.evaluate<string>(pageJson(body));
	return JSON.parse(raw) as T;
}

/**
 * INV-1 — Composer focus after "New chat".
 * Executes the new-chat command, then asserts document.activeElement is the
 * composer textarea. Guards the focus-return class (composer focus lost
 * after send / stop / new chat).
 */
const composerFocusNewChat: Invariant = {
	id: "INV-1",
	name: "Composer focus after new chat",
	guards: "focus-return class (I166)",
	async run(cdp) {
		await cdp.executeCommand(`${PLUGIN_ID}:open-chat-view`);
		await cdp.waitForElement(".agent-client-chat-input-textarea");
		await cdp.executeCommand(`${PLUGIN_ID}:new-chat`);
		// Focus lands after React commit; poll briefly instead of a blind sleep.
		const deadline = Date.now() + 3000;
		let detail = "";
		while (Date.now() < deadline) {
			const r = await evalJson<{ focused: boolean; active: string }>(
				cdp,
				`const ae = document.activeElement;
				 return {
					focused: !!ae && ae.classList.contains("agent-client-chat-input-textarea"),
					active: ae ? (ae.tagName + "." + (ae.className || "")) : "none",
				 };`,
			);
			if (r.focused) {
				return { status: "pass", detail: "activeElement is the composer textarea" };
			}
			detail = r.active;
			await new Promise((res) => setTimeout(res, 100));
		}
		return {
			status: "fail",
			detail: `composer not focused after new-chat; activeElement=${detail}`,
		};
	},
};

/**
 * INV-2 — No chat-UI keymap scope while the panel is inactive.
 * Switches the active leaf to a fresh empty leaf (a real focus-leave, the
 * user action behind the regression class), then asserts no scope on the
 * keymap stack is — or descends from — the chat view's scope. Obsidian
 * itself keeps the ACTIVE view's own (keyless) scope pushed; that is normal
 * and excluded. Restores the chat leaf afterwards. Guards the scope-leak
 * class (Cmd+W firing in editor leaves, accumulated scopes).
 */
const keymapScopeBalance: Invariant = {
	id: "INV-2",
	name: "No chat-UI keymap scope when panel inactive",
	guards: "scope-leak class (I156/I161/I155)",
	async run(cdp) {
		// A focus-shifting evaluate frequently drops its CDP response even
		// though the side effect lands (same pattern as Cdp.focusWindow).
		const evalTolerant = async (expr: string) => {
			try {
				await cdp.evaluate(expr);
			} catch {
				/* response dropped; side effect still lands */
			}
		};
		await evalTolerant(
			`(() => {
				const ws = window.app.workspace;
				const tmp = ws.getLeaf("tab");
				window.__invariantSuiteTempLeaf = tmp;
				ws.setActiveLeaf(tmp, { focus: true });
				return true;
			})()`,
		);
		await new Promise((res) => setTimeout(res, 400));
		try {
			const r = await evalJson<{
				switched: boolean;
				chatScopesOnStack: number;
				prevScopes: number;
			}>(
				cdp,
				`const ws = window.app.workspace;
				 const km = window.app.keymap;
				 const chatLeaf = ws.getLeavesOfType("${VIEW_TYPE}")[0];
				 const chatScope = chatLeaf ? chatLeaf.view.scope : null;
				 const active = ws.activeLeaf ? ws.activeLeaf.view.getViewType() : "none";
				 const stack = [km.scope, ...(km.prevScopes || [])];
				 const descendsFromChat = (s) => {
					let c = s, i = 0;
					while (c && i < 10) {
						if (chatScope && c === chatScope) return true;
						c = c.parent; i++;
					}
					return false;
				 };
				 return {
					switched: active !== "${VIEW_TYPE}",
					chatScopesOnStack: chatScope ? stack.filter(descendsFromChat).length : 0,
					prevScopes: (km.prevScopes || []).length,
				 };`,
			);
			if (!r.switched) {
				return {
					status: "skip",
					detail: "could not move active leaf off the chat view; probe inconclusive",
				};
			}
			if (r.chatScopesOnStack > 0) {
				return {
					status: "fail",
					detail: `${r.chatScopesOnStack} chat-UI scope(s) still on the keymap stack while the panel is inactive (prevScopes=${r.prevScopes})`,
				};
			}
			return {
				status: "pass",
				detail: "no chat-UI scope on the keymap stack with the panel inactive",
			};
		} finally {
			await evalTolerant(
				`(() => {
					const ws = window.app.workspace;
					const tmp = window.__invariantSuiteTempLeaf;
					if (tmp) { tmp.detach(); delete window.__invariantSuiteTempLeaf; }
					const chat = ws.getLeavesOfType("${VIEW_TYPE}")[0];
					if (chat) ws.setActiveLeaf(chat, { focus: true });
					return true;
				})()`,
			);
		}
	},
};

/**
 * INV-3 — Persisted-state integrity: saved-session index ⇔ disk artifacts,
 * and per-leaf tab slices reference known sessions. Guards the restore
 * class (blank restored history, session-store split).
 */
const persistedStateIntegrity: Invariant = {
	id: "INV-3",
	name: "Session index ⇔ disk artifacts ⇔ tab slices",
	guards: "restore class (TP-I01/TP-I06, I72)",
	async run(cdp) {
		const awaited = await cdp.evaluate<string>(
			`(async () => {
				const p = window.app.plugins.plugins["${PLUGIN_ID}"];
				const s = p.settings;
				const sessions = s.savedSessions || [];
				const dir = ".obsidian/plugins/${PLUGIN_ID}/sessions";
				let files = [];
				try {
					files = (await window.app.vault.adapter.list(dir)).files.map((f) => f.split("/").pop());
				} catch (e) {
					files = [];
				}
				const invalidEntries = sessions.filter((x) => !x.sessionId || !x.agentId).length;
				const missingFiles = sessions
					.filter((x) => !files.includes(x.sessionId + ".json"))
					.map((x) => x.sessionId);
				const known = new Set(sessions.map((x) => x.sessionId));
				const orphanSlices = [];
				for (const leaf of s.perLeafTabStates || []) {
					for (const t of leaf.tabs || []) {
						if (t.sessionId && !known.has(t.sessionId)) orphanSlices.push(t.sessionId);
					}
				}
				return JSON.stringify({ missingFiles, orphanSlices, invalidEntries, sessions: sessions.length });
			})()`,
			{ awaitPromise: true },
		);
		const parsed = JSON.parse(awaited) as {
			missingFiles: string[];
			orphanSlices: string[];
			invalidEntries: number;
			sessions: number;
		};
		const problems: string[] = [];
		if (parsed.invalidEntries > 0)
			problems.push(`${parsed.invalidEntries} index entries missing sessionId/agentId`);
		if (parsed.missingFiles.length > 0)
			problems.push(`index entries without disk file: ${parsed.missingFiles.join(", ")}`);
		if (parsed.orphanSlices.length > 0)
			problems.push(`tab slices referencing unknown sessions: ${parsed.orphanSlices.join(", ")}`);
		if (problems.length > 0) return { status: "fail", detail: problems.join("; ") };
		return {
			status: "pass",
			detail: `${parsed.sessions} index entries all have disk artifacts; all tab slices resolve`,
		};
	},
};

/**
 * INV-4 — Agent list completeness. getAvailableAgents() (the source every
 * picker renders from) must contain unique, non-empty ids and include every
 * enabled custom agent. Guards the wiring class (built-in/custom agents
 * absent from dropdown / picker).
 */
const agentListsComplete: Invariant = {
	id: "INV-4",
	name: "Agent pickers' data source is complete",
	guards: "wiring class (I167/I171)",
	async run(cdp) {
		const r = await evalJson<{
			ids: string[];
			customEnabled: string[];
			defaultAgentId: string | null;
		}>(
			cdp,
			`const p = window.app.plugins.plugins["${PLUGIN_ID}"];
			 const ids = p.getAvailableAgents().map((a) => a.id);
			 const customEnabled = (p.settings.customAgents || [])
				.filter((c) => c.enabled !== false)
				.map((c) => c.id);
			 return { ids, customEnabled, defaultAgentId: p.settings.defaultAgentId ?? null };`,
		);
		const problems: string[] = [];
		if (r.ids.length === 0) problems.push("getAvailableAgents() is empty");
		if (new Set(r.ids).size !== r.ids.length) problems.push("duplicate agent ids");
		if (r.ids.some((id) => !id)) problems.push("empty agent id present");
		const missingCustom = r.customEnabled.filter((id) => !r.ids.includes(id));
		if (missingCustom.length > 0)
			problems.push(`enabled custom agents missing: ${missingCustom.join(", ")}`);
		if (r.defaultAgentId && !r.ids.includes(r.defaultAgentId))
			problems.push(`defaultAgentId ${r.defaultAgentId} not in available agents`);
		if (problems.length > 0) return { status: "fail", detail: problems.join("; ") };
		return { status: "pass", detail: `${r.ids.length} agents, unique, custom+default resolved` };
	},
};

/**
 * INV-5 — Notification click reveal path. The onclick's foregrounding
 * mechanism is ChatView.revealOwningLeaf() (revealLeaf + setActiveLeaf);
 * every I52-class fix depends on it. Probes (1) the wiring — the chat view
 * exposes revealOwningLeaf (the missing-leaf-handle class), and (2) the
 * behavior — with another leaf active, revealOwningLeaf() reactivates the
 * chat leaf. The cross-window macOS activation race itself remains
 * human-verified (SF-6 / I52 T-recur repeated clicks).
 */
const notificationRouting: Invariant = {
	id: "INV-5",
	name: "Notification click reveal path (revealOwningLeaf)",
	guards: "notification class (I52 ×3, I168)",
	async run(cdp) {
		const evalTolerant = async (expr: string) => {
			try {
				await cdp.evaluate(expr);
			} catch {
				/* focus-shifting evaluate may drop its response; side effect lands */
			}
		};
		// Wiring check first (read-only).
		const wiring = await evalJson<{ hasLeaf: boolean; hasReveal: boolean }>(
			cdp,
			`const chat = window.app.workspace.getLeavesOfType("${VIEW_TYPE}")[0];
			 return {
				hasLeaf: !!chat,
				hasReveal: !!chat && typeof chat.view.revealOwningLeaf === "function",
			 };`,
		);
		if (!wiring.hasLeaf) {
			return { status: "skip", detail: "no chat view open; wiring unprobeable" };
		}
		if (!wiring.hasReveal) {
			return {
				status: "fail",
				detail: "ChatView does not expose revealOwningLeaf() — notification clicks have no sanctioned foregrounding path",
			};
		}
		// Behavior check: activate a temp leaf, reveal, expect the chat leaf back.
		await evalTolerant(
			`(() => {
				const ws = window.app.workspace;
				const tmp = ws.getLeaf("tab");
				window.__invariantSuiteInv5Leaf = tmp;
				ws.setActiveLeaf(tmp, { focus: true });
				return true;
			})()`,
		);
		await new Promise((res) => setTimeout(res, 300));
		try {
			await evalTolerant(
				`(() => {
					const chat = window.app.workspace.getLeavesOfType("${VIEW_TYPE}")[0];
					chat.view.revealOwningLeaf();
					return true;
				})()`,
			);
			// revealOwningLeaf resolves async (revealLeaf then setActiveLeaf);
			// poll for the reactivation instead of a single blind read.
			const deadline = Date.now() + 3000;
			let lastActive = "";
			while (Date.now() < deadline) {
				const r = await evalJson<{ active: string }>(
					cdp,
					`const ws = window.app.workspace;
					 return { active: ws.activeLeaf ? ws.activeLeaf.view.getViewType() : "none" };`,
				);
				if (r.active === VIEW_TYPE) {
					return {
						status: "pass",
						detail: "revealOwningLeaf() reactivated the chat leaf from a background state (cross-window OS race stays human-verified per SF-6)",
					};
				}
				lastActive = r.active;
				await new Promise((res) => setTimeout(res, 100));
			}
			return {
				status: "fail",
				detail: `revealOwningLeaf() did not reactivate the chat leaf (active view stayed ${lastActive})`,
			};
		} finally {
			await evalTolerant(
				`(() => {
					const tmp = window.__invariantSuiteInv5Leaf;
					if (tmp) { tmp.detach(); delete window.__invariantSuiteInv5Leaf; }
					return true;
				})()`,
			);
		}
	},
};

/**
 * INV-6 — Quick-prompt chips carry non-empty labels. Guards the cold-start
 * label race (chips rendered with blank/stale labels before metadataCache
 * resolved).
 */
const quickPromptLabels: Invariant = {
	id: "INV-6",
	name: "Quick-prompt chip labels non-empty",
	guards: "cold-start label race (QP-I27)",
	async run(cdp) {
		const r = await evalJson<{ total: number; empty: number; folderSet: boolean }>(
			cdp,
			`const p = window.app.plugins.plugins["${PLUGIN_ID}"];
			 const labels = Array.from(document.querySelectorAll(".agent-client-quick-prompt-chip-label"));
			 return {
				total: labels.length,
				empty: labels.filter((e) => !(e.textContent || "").trim()).length,
				folderSet: !!p.settings.quickPromptsFolder,
			 };`,
		);
		if (!r.folderSet) return { status: "skip", detail: "no quick-prompts folder configured in this vault" };
		if (r.total === 0)
			return { status: "fail", detail: "quick-prompts folder configured but zero chips rendered" };
		if (r.empty > 0)
			return { status: "fail", detail: `${r.empty}/${r.total} chips have empty labels` };
		return { status: "pass", detail: `${r.total} chips, all labeled` };
	},
};

/** Chat view must exist before DOM probes run. */
export async function ensureChatViewOpen(cdp: Cdp): Promise<void> {
	const count = await cdp.evaluate<number>(
		`window.app.workspace.getLeavesOfType("${VIEW_TYPE}").length`,
	);
	if (count === 0) {
		await cdp.executeCommand(`${PLUGIN_ID}:open-chat-view`);
	}
	await cdp.waitForElement(".agent-client-chat-input-textarea", 10000);
}

export const invariants: Invariant[] = [
	composerFocusNewChat,
	keymapScopeBalance,
	persistedStateIntegrity,
	agentListsComplete,
	notificationRouting,
	quickPromptLabels,
];

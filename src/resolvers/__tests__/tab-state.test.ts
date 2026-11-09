/**
 * Truth table + reproduce cases for `deriveTabState` — the single pure resolver
 * for a tab's visual state icon.
 *
 * WHY THIS EXISTS (the bug this reproduces)
 * The tab icon state used to be driven by two edge-triggered effects in
 * ChatPanel that mutated the `useTabSessionState` machine:
 *
 *     if (!wasSending && isSending && lazySession.state === "ready")
 *         lazySession.startBusy();          // ← gated on state === "ready"
 *
 * For a lazy tab's FIRST send, `isSending` rises *while the session is still
 * "connecting"* (session acquisition and send-intent happen in the same beat).
 * The `state === "ready"` guard is therefore false at the rising edge, so
 * `startBusy()` never fires. When the session then transitions
 * connecting → ready, `isSending` is already true — there is no new rising
 * edge — so the tab is stuck showing ● "ready" for the entire streamed reply
 * instead of ◐ "busy". A background tab whose session was already `ready` when
 * its send began transitions correctly, which is why only the *active,
 * just-connected* tab showed the wrong glyph.
 *
 * A second path produced the same symptom: `resolvePermission` always returns
 * the machine to `ready`, so if a permission prompt resolved mid-turn while the
 * agent kept working, the tab dropped to `ready` even though `isSending` was
 * still true.
 *
 * FIX
 * Both are the same class — busy was inferred from fragile edge transitions
 * gated on connection state, rather than derived from the actual "is the agent
 * working" intent. `deriveTabState` gates busy on `isSending` (intent) and
 * permission on `hasActivePermission`, overlaid on the connection lifecycle —
 * recomputed every render, so a missed edge can't strand the icon.
 *
 * Pure — no React, no Obsidian. Exhaustively testable over every input.
 *
 * I292: a restored tab that hasn't woken sits in `idle` while holding a
 * session id; it must show the moon like a released tab, not the ready dot.
 */

import { describe, expect, it } from "vitest";
import { deriveTabState, hasFailedTurnBanner } from "../tab-state";
import type { ErrorInfo } from "../../types/errors";
import type { TabSessionState, TabState, TabUnseen } from "../../types/tab";

const LIFECYCLES: TabSessionState[] = [
	"idle",
	"connecting",
	"ready",
	"busy",
	"permission",
	"error",
	"released",
];
const BOOLS = [true, false];
const UNSEEN: TabUnseen[] = [null, { kind: "done" }, { kind: "stopped" }];

/**
 * Reference spec ([[Tab Attention States]] § Resolver), written as a priority
 * list independent of the implementation's control flow.
 */
function expected(
	lifecycle: TabSessionState,
	isSending: boolean,
	hasActivePermission: boolean,
	unseen: TabUnseen,
	hasHeldSession: boolean,
	failedBanner: boolean,
): TabState {
	if (lifecycle === "error") return "error";
	if (lifecycle === "connecting") return "connecting";
	// Attention order (I316): stopped early unseen → last message failed →
	// finished unseen. A failed turn and a finished one can't both be true.
	const unseenState: TabState | null =
		unseen?.kind === "stopped"
			? "stoppedUnseen"
			: failedBanner
				? "failed"
				: unseen?.kind === "done"
					? "doneUnseen"
					: null;
	// idle with no held id = a fresh lazy tab that connects on the first send.
	if (lifecycle === "idle" && !hasHeldSession) return isSending ? "connecting" : "ready";
	// idle holding an id = a restored tab that hasn't woken (I292): asleep,
	// like released, but a pending send shows it connecting.
	if (lifecycle === "idle") {
		if (isSending) return "connecting";
		return unseenState ?? "released";
	}
	// Asleep: the process is gone, so stale sending/permission flags are
	// ignored, but an unread result still outranks the moon.
	if (lifecycle === "released") return unseenState ?? "released";
	if (hasActivePermission) return "permission";
	if (isSending) return "busy";
	return unseenState ?? "ready";
}

describe("deriveTabState — exhaustive truth table", () => {
	for (const lifecycle of LIFECYCLES) {
		for (const isSending of BOOLS) {
			for (const hasActivePermission of BOOLS) {
				for (const unseen of UNSEEN) {
					for (const hasHeldSession of BOOLS) {
						for (const failedBanner of BOOLS) {
							const label = `${lifecycle}/sending=${isSending}/perm=${hasActivePermission}/unseen=${unseen?.kind ?? "none"}/held=${hasHeldSession}/failed=${failedBanner}`;
							it(label, () => {
								expect(
									deriveTabState({
										lifecycle,
										isSending,
										hasActivePermission,
										unseen,
										hasHeldSession,
										hasFailedTurnBanner: failedBanner,
									}),
								).toBe(
									expected(lifecycle, isSending, hasActivePermission, unseen, hasHeldSession, failedBanner),
								);
							});
						}
					}
				}
			}
		}
	}
});

describe("deriveTabState — reproduce cases", () => {
	// I172: active tab just connected on its first send and is streaming.
	it("lazy first-send, now streaming: ready lifecycle + isSending → busy", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: false, unseen: null, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("busy");
	});

	it("active permission wins over sending: → permission", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: true, unseen: null, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("permission");
	});

	// Tab Attention States: a new lazy tab can be typed into right away, so it
	// reads as ready, not as a dead session (was → disconnected).
	it("new lazy tab (never sent): idle → ready", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: false, hasActivePermission: false, unseen: null, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("ready");
	});

	// Tab Attention States: connecting gets its own icon (was → disconnected).
	it("connecting with a pending send: → connecting", () => {
		expect(
			deriveTabState({ lifecycle: "connecting", isSending: true, hasActivePermission: false, unseen: null, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("connecting");
	});

	// The reported problem: a finished background tab looked like a new one.
	it("finished turn not yet viewed: → doneUnseen", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: false, hasActivePermission: false, unseen: { kind: "done" }, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("doneUnseen");
	});

	it("a new send hides the tick while working: → busy", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: false, unseen: { kind: "done" }, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("busy");
	});

	it("unread result outranks asleep: released + done → doneUnseen", () => {
		expect(
			deriveTabState({ lifecycle: "released", isSending: false, hasActivePermission: false, unseen: { kind: "done" }, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("doneUnseen");
	});

	it("acquisition failed: → error regardless of other signals", () => {
		expect(
			deriveTabState({ lifecycle: "error", isSending: true, hasActivePermission: true, unseen: { kind: "done" }, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("error");
	});
});

// I292: after a restart, restored tabs stay `idle` until you type, holding the
// restored session id. Literals only (R5).
describe("deriveTabState — I292 restored tab that hasn't woken", () => {
	it("idle + held session → released (the moon)", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: false, hasActivePermission: false, unseen: null, hasHeldSession: true, hasFailedTurnBanner: false }),
		).toBe("released");
	});

	it("idle + no held session → ready (a fresh tab)", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: false, hasActivePermission: false, unseen: null, hasHeldSession: false, hasFailedTurnBanner: false }),
		).toBe("ready");
	});

	it("idle + held session + sending → connecting", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: true, hasActivePermission: false, unseen: null, hasHeldSession: true, hasFailedTurnBanner: false }),
		).toBe("connecting");
	});

	it("idle + held session + unseen done → doneUnseen", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: false, hasActivePermission: false, unseen: { kind: "done" }, hasHeldSession: true, hasFailedTurnBanner: false }),
		).toBe("doneUnseen");
	});
});

// I316: a failed turn you've seen used to read "Ready" while its error banner
// was still up (11/09, Kiro V3 throttle, rail flyout). Literals only (R5).
describe("deriveTabState — I316 last message failed", () => {
	const live = { isSending: false, hasActivePermission: false, hasHeldSession: false };

	it("live + seen failed turn with its banner up → failed (was ready)", () => {
		expect(deriveTabState({ lifecycle: "ready", ...live, unseen: null, hasFailedTurnBanner: true })).toBe("failed");
	});

	it("an unseen failure keeps its stopped-early mark", () => {
		expect(deriveTabState({ lifecycle: "ready", ...live, unseen: { kind: "stopped" }, hasFailedTurnBanner: true })).toBe("stoppedUnseen");
	});

	it("sending again shows busy", () => {
		expect(deriveTabState({ lifecycle: "ready", ...live, isSending: true, unseen: null, hasFailedTurnBanner: true })).toBe("busy");
	});

	it("a pending permission outranks it", () => {
		expect(deriveTabState({ lifecycle: "ready", ...live, hasActivePermission: true, unseen: null, hasFailedTurnBanner: true })).toBe("permission");
	});

	it("a dead session still shows error", () => {
		expect(deriveTabState({ lifecycle: "error", ...live, unseen: null, hasFailedTurnBanner: true })).toBe("error");
	});

	it("asleep with the banner still up → failed, not the moon", () => {
		expect(deriveTabState({ lifecycle: "released", ...live, unseen: null, hasFailedTurnBanner: true })).toBe("failed");
	});

	it("restored idle tab with a held session and a banner → failed (defensive: errorInfo starts null on restore)", () => {
		expect(deriveTabState({ lifecycle: "idle", ...live, hasHeldSession: true, unseen: null, hasFailedTurnBanner: true })).toBe("failed");
	});

	it("a fresh lazy tab ignores the flag (it can't have a failed turn)", () => {
		expect(deriveTabState({ lifecycle: "idle", ...live, unseen: null, hasFailedTurnBanner: true })).toBe("ready");
	});
});

describe("hasFailedTurnBanner — I316", () => {
	const err: ErrorInfo = { title: "Agent Error", message: "high traffic" };

	it("true when the banner on screen is the one the failed turn raised", () => {
		expect(hasFailedTurnBanner({ seq: 1, outcome: "failed", errorInfo: err }, err)).toBe(true);
	});

	it("false once the banner is dismissed", () => {
		expect(hasFailedTurnBanner({ seq: 1, outcome: "failed", errorInfo: err }, null)).toBe(false);
	});

	it("false when a different error replaced the banner (identity, not equality)", () => {
		expect(hasFailedTurnBanner({ seq: 1, outcome: "failed", errorInfo: err }, { ...err })).toBe(false);
	});

	it("false when the last turn didn't fail", () => {
		expect(hasFailedTurnBanner({ seq: 2, outcome: "endTurn" }, err)).toBe(false);
		expect(hasFailedTurnBanner(null, err)).toBe(false);
	});
});

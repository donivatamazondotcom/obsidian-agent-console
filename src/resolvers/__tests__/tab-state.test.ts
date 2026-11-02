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
 * Pure — no React, no Obsidian. Exhaustively testable (6 × 2 × 2 = 24 rows).
 */

import { describe, expect, it } from "vitest";
import { deriveTabState } from "../tab-state";
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
): TabState {
	if (lifecycle === "error") return "error";
	if (lifecycle === "connecting") return "connecting";
	// idle = a fresh lazy tab that connects on the first send.
	if (lifecycle === "idle") return isSending ? "connecting" : "ready";
	const unseenState: TabState | null =
		unseen === null ? null : unseen.kind === "done" ? "doneUnseen" : "stoppedUnseen";
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
					const label = `${lifecycle}/sending=${isSending}/perm=${hasActivePermission}/unseen=${unseen?.kind ?? "none"}`;
					it(label, () => {
						expect(
							deriveTabState({
								lifecycle,
								isSending,
								hasActivePermission,
								unseen,
							}),
						).toBe(
							expected(lifecycle, isSending, hasActivePermission, unseen),
						);
					});
				}
			}
		}
	}
});

describe("deriveTabState — reproduce cases", () => {
	// I172: active tab just connected on its first send and is streaming.
	it("lazy first-send, now streaming: ready lifecycle + isSending → busy", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: false, unseen: null }),
		).toBe("busy");
	});

	it("active permission wins over sending: → permission", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: true, unseen: null }),
		).toBe("permission");
	});

	// Tab Attention States: a new lazy tab can be typed into right away, so it
	// reads as ready, not as a dead session (was → disconnected).
	it("new lazy tab (never sent): idle → ready", () => {
		expect(
			deriveTabState({ lifecycle: "idle", isSending: false, hasActivePermission: false, unseen: null }),
		).toBe("ready");
	});

	// Tab Attention States: connecting gets its own icon (was → disconnected).
	it("connecting with a pending send: → connecting", () => {
		expect(
			deriveTabState({ lifecycle: "connecting", isSending: true, hasActivePermission: false, unseen: null }),
		).toBe("connecting");
	});

	// The reported problem: a finished background tab looked like a new one.
	it("finished turn not yet viewed: → doneUnseen", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: false, hasActivePermission: false, unseen: { kind: "done" } }),
		).toBe("doneUnseen");
	});

	it("a new send hides the tick while working: → busy", () => {
		expect(
			deriveTabState({ lifecycle: "ready", isSending: true, hasActivePermission: false, unseen: { kind: "done" } }),
		).toBe("busy");
	});

	it("unread result outranks asleep: released + done → doneUnseen", () => {
		expect(
			deriveTabState({ lifecycle: "released", isSending: false, hasActivePermission: false, unseen: { kind: "done" } }),
		).toBe("doneUnseen");
	});

	it("acquisition failed: → error regardless of other signals", () => {
		expect(
			deriveTabState({ lifecycle: "error", isSending: true, hasActivePermission: true, unseen: { kind: "done" } }),
		).toBe("error");
	});
});

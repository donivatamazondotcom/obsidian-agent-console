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
import type { TabSessionState } from "../../hooks/useTabSessionState";
import type { TabState } from "../../types/tab";

const LIFECYCLES: TabSessionState[] = [
	"idle",
	"connecting",
	"ready",
	"busy",
	"permission",
	"error",
];
const BOOLS = [true, false];

/** Reference spec, independent of the implementation's control flow. */
function expected(
	lifecycle: TabSessionState,
	isSending: boolean,
	hasActivePermission: boolean,
): TabState {
	if (lifecycle === "error") return "error";
	if (lifecycle === "idle" || lifecycle === "connecting")
		return "disconnected";
	// live lifecycle (ready/busy/permission): overlay intent signals
	if (hasActivePermission) return "permission";
	if (isSending) return "busy";
	return "ready";
}

describe("deriveTabState — exhaustive truth table", () => {
	for (const lifecycle of LIFECYCLES) {
		for (const isSending of BOOLS) {
			for (const hasActivePermission of BOOLS) {
				const label = `${lifecycle}/sending=${isSending}/perm=${hasActivePermission}`;
				it(label, () => {
					expect(
						deriveTabState({
							lifecycle,
							isSending,
							hasActivePermission,
						}),
					).toBe(expected(lifecycle, isSending, hasActivePermission));
				});
			}
		}
	}
});

describe("deriveTabState — reproduce cases (the reported bug)", () => {
	// The exact failure in the screenshot: active tab just connected on its
	// first send and is streaming a reply. Before the fix this stranded at
	// "ready"; it MUST be "busy".
	it("lazy first-send, now streaming: ready lifecycle + isSending → busy", () => {
		expect(
			deriveTabState({
				lifecycle: "ready",
				isSending: true,
				hasActivePermission: false,
			}),
		).toBe("busy");
	});

	// Second path: a mid-turn permission resolved while the agent keeps
	// working. isSending is still true → must return to busy, not ready.
	it("permission resolved mid-turn, still working: ready + isSending, no active permission → busy", () => {
		expect(
			deriveTabState({
				lifecycle: "ready",
				isSending: true,
				hasActivePermission: false,
			}),
		).toBe("busy");
	});

	it("active permission wins over sending: → permission", () => {
		expect(
			deriveTabState({
				lifecycle: "ready",
				isSending: true,
				hasActivePermission: true,
			}),
		).toBe("permission");
	});

	it("idle lazy tab (never sent): → disconnected", () => {
		expect(
			deriveTabState({
				lifecycle: "idle",
				isSending: false,
				hasActivePermission: false,
			}),
		).toBe("disconnected");
	});

	it("connecting with a pending send does not yet show busy: → disconnected", () => {
		expect(
			deriveTabState({
				lifecycle: "connecting",
				isSending: true,
				hasActivePermission: false,
			}),
		).toBe("disconnected");
	});

	it("acquisition failed: → error regardless of other signals", () => {
		expect(
			deriveTabState({
				lifecycle: "error",
				isSending: true,
				hasActivePermission: true,
			}),
		).toBe("error");
	});

	it("idle finished turn: ready lifecycle, not sending → ready", () => {
		expect(
			deriveTabState({
				lifecycle: "ready",
				isSending: false,
				hasActivePermission: false,
			}),
		).toBe("ready");
	});
});

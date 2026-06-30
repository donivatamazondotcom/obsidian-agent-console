/**
 * Truth-table test for `deriveSendAffordance` — the single pure resolver that
 * decides send-button enablement across ChatPanel.canSend, InputArea's
 * isButtonDisabled, InputToolbar's aria-label, MessageList's empty-state, and
 * the broadcast dispatch-vs-queue bail.
 *
 * Written test-first (RED before the resolver exists). The historically-wrong
 * cells are the regression cluster the resolver consolidates:
 *   - I40: an *idle* tab with content is sendable (and must NOT read as
 *     "Connecting…") — reason must be "ready", canSend true, button enabled.
 *   - I41: a *connecting* tab with content is sendable (send-while-connecting
 *     queue path) — reason "ready", canSend true, button enabled.
 *
 * Design (approved option (a), 2026-06-27): the resolver keys on the full
 * 6-member TabSessionState union (idle|connecting|ready|busy|permission|error)
 * — `busy`/`permission` are "live" — and drops the separate `isSessionReady`
 * boolean (lazyState is the canonical readiness signal). `canSend` mirrors the
 * prior ChatPanel.canSend, which did NOT block on `isQueued` (the queue-of-one
 * cap is a downstream guard; broadcast excludes queued tabs via
 * hasPendingQueue()), so canSend is true for reason ∈ {ready, queued}.
 */
import { describe, it, expect } from "vitest";
import {
	deriveSendAffordance,
	isSessionLive,
	type SendAffordanceInput,
	type SendAffordanceReason,
} from "../../resolvers/send-affordance";
import type { TabSessionState } from "../../hooks/useTabSessionState";

const ALL_STATES: TabSessionState[] = [
	"idle",
	"connecting",
	"ready",
	"busy",
	"permission",
	"error",
];

/** A "ready to send" baseline: content present, nothing blocking. */
function base(overrides: Partial<SendAffordanceInput> = {}): SendAffordanceInput {
	return {
		lazyState: "ready",
		isSending: false,
		isQueued: false,
		hasContent: true,
		isRestoringSession: false,
		...overrides,
	};
}

describe("deriveSendAffordance — explicit cells", () => {
	interface Row {
		name: string;
		input: SendAffordanceInput;
		canSend: boolean;
		buttonDisabled: boolean;
		reason: SendAffordanceReason;
	}

	const rows: Row[] = [
		{
			name: "ready + content → sendable",
			input: base(),
			canSend: true,
			buttonDisabled: false,
			reason: "ready",
		},
		{
			// I40: idle tab with content is sendable; reason must be "ready"
			// (the idle-vs-connecting wording is the consumer's job off lazyState,
			// NOT a disabled/blocked reason).
			name: "I40: idle + content → sendable (not 'Connecting…')",
			input: base({ lazyState: "idle" }),
			canSend: true,
			buttonDisabled: false,
			reason: "ready",
		},
		{
			// I41: send-while-connecting must be allowed.
			name: "I41: connecting + content → sendable",
			input: base({ lazyState: "connecting" }),
			canSend: true,
			buttonDisabled: false,
			reason: "ready",
		},
		{
			name: "empty composer → blocked, button disabled",
			input: base({ hasContent: false }),
			canSend: false,
			buttonDisabled: true,
			reason: "empty",
		},
		{
			name: "queued (held, not sending) → button disabled, but canSend true (downstream cap)",
			input: base({ isQueued: true }),
			canSend: true,
			buttonDisabled: true,
			reason: "queued",
		},
		{
			name: "restoring session → blocked, button disabled",
			input: base({ isRestoringSession: true }),
			canSend: false,
			buttonDisabled: true,
			reason: "restoring",
		},
		{
			name: "error state → blocked, button disabled",
			input: base({ lazyState: "error" }),
			canSend: false,
			buttonDisabled: true,
			reason: "error",
		},
		{
			name: "sending → button enabled (Stop control), canSend false",
			input: base({ isSending: true, lazyState: "busy" }),
			canSend: false,
			buttonDisabled: false,
			reason: "sending",
		},
		{
			name: "permission (live) + content → sendable",
			input: base({ lazyState: "permission" }),
			canSend: true,
			buttonDisabled: false,
			reason: "ready",
		},
		{
			// Priority: sending wins over restoring/empty/etc.
			name: "sending takes priority over restoring",
			input: base({ isSending: true, isRestoringSession: true }),
			canSend: false,
			buttonDisabled: false,
			reason: "sending",
		},
		{
			// Priority: restoring wins over error/empty/queued.
			name: "restoring takes priority over error",
			input: base({ isRestoringSession: true, lazyState: "error" }),
			canSend: false,
			buttonDisabled: true,
			reason: "restoring",
		},
		{
			// Priority: error wins over empty/queued.
			name: "error takes priority over empty",
			input: base({ lazyState: "error", hasContent: false }),
			canSend: false,
			buttonDisabled: true,
			reason: "error",
		},
		{
			// Priority: empty wins over queued.
			name: "empty takes priority over queued",
			input: base({ hasContent: false, isQueued: true }),
			canSend: false,
			buttonDisabled: true,
			reason: "empty",
		},
	];

	for (const row of rows) {
		it(row.name, () => {
			const out = deriveSendAffordance(row.input);
			expect(out.canSend, "canSend").toBe(row.canSend);
			expect(out.buttonDisabled, "buttonDisabled").toBe(row.buttonDisabled);
			expect(out.reason, "reason").toBe(row.reason);
		});
	}
});

describe("deriveSendAffordance — invariants over the full input cube", () => {
	function* cube(): Generator<SendAffordanceInput> {
		for (const lazyState of ALL_STATES) {
			for (const isSending of [false, true]) {
				for (const isQueued of [false, true]) {
					for (const hasContent of [false, true]) {
						for (const isRestoringSession of [false, true]) {
							yield {
								lazyState,
								isSending,
								isQueued,
								hasContent,
								isRestoringSession,
							};
						}
					}
				}
			}
		}
	}

	it("isSending ⟹ reason 'sending' AND button enabled (Stop)", () => {
		for (const input of cube()) {
			if (!input.isSending) continue;
			const out = deriveSendAffordance(input);
			expect(out.reason).toBe("sending");
			expect(out.buttonDisabled).toBe(false);
			expect(out.canSend).toBe(false);
		}
	});

	it("canSend ⟺ reason ∈ {ready, queued}", () => {
		for (const input of cube()) {
			const out = deriveSendAffordance(input);
			const expected = out.reason === "ready" || out.reason === "queued";
			expect(out.canSend).toBe(expected);
		}
	});

	it("canSend ⟹ hasContent (never send an empty composer)", () => {
		for (const input of cube()) {
			const out = deriveSendAffordance(input);
			if (out.canSend) expect(input.hasContent).toBe(true);
		}
	});

	it("error state is never sendable", () => {
		for (const input of cube()) {
			if (input.lazyState !== "error") continue;
			const out = deriveSendAffordance(input);
			expect(out.canSend).toBe(false);
		}
	});

	it("restoring is never sendable", () => {
		for (const input of cube()) {
			if (!input.isRestoringSession) continue;
			const out = deriveSendAffordance(input);
			expect(out.canSend).toBe(false);
		}
	});

	it("reason 'ready' ⟺ enabled button AND canSend", () => {
		for (const input of cube()) {
			const out = deriveSendAffordance(input);
			if (out.reason === "ready") {
				expect(out.buttonDisabled).toBe(false);
				expect(out.canSend).toBe(true);
			}
		}
	});

	it("button enabled ⟺ reason ∈ {ready, sending}", () => {
		for (const input of cube()) {
			const out = deriveSendAffordance(input);
			const enabled = !out.buttonDisabled;
			const expected = out.reason === "ready" || out.reason === "sending";
			expect(enabled).toBe(expected);
		}
	});
});

describe("isSessionLive — dispatch readiness (replaces scattered !isSessionReady)", () => {
	it("ready|busy|permission are live; idle|connecting|error are not", () => {
		expect(isSessionLive("ready")).toBe(true);
		expect(isSessionLive("busy")).toBe(true);
		expect(isSessionLive("permission")).toBe(true);
		expect(isSessionLive("idle")).toBe(false);
		expect(isSessionLive("connecting")).toBe(false);
		expect(isSessionLive("error")).toBe(false);
	});
});

/**
 * Exhaustive truth table for `deriveComposerFocusContract` + `applyComposerFocus`
 * — the single composer-focus decision (I166).
 *
 * The EXPECTED record is typed `Record<ComposerAction, ComposerFocusContract>`,
 * so adding a new `ComposerAction` member without classifying it here is a
 * compile error — the test is itself a forcing function alongside the resolver's
 * exhaustive switch. Mirrors the send-affordance resolver's table+invariant
 * pattern.
 */
import { describe, it, expect, vi } from "vitest";
import {
	deriveComposerFocusContract,
	applyComposerFocus,
	type ComposerAction,
	type ComposerFocusContract,
} from "../composer-focus";

/** Every governed action, with its expected contract. */
const EXPECTED: Record<ComposerAction, ComposerFocusContract> = {
	// Composer-terminal.
	send: "unconditional",
	stop: "unconditional",
	"new-chat": "unconditional",
	// In-panel adjustments.
	"set-model": "guarded",
	"set-mode": "guarded",
	"set-config-option": "guarded",
	"context-add": "guarded",
	"context-remove": "guarded",
	"suppress-provisional": "guarded",
	reload: "guarded",
	"seed-initial-prompt": "guarded",
};

const ALL_ACTIONS = Object.keys(EXPECTED) as ComposerAction[];

describe("deriveComposerFocusContract — every action is classified", () => {
	for (const action of ALL_ACTIONS) {
		it(`${action} → ${EXPECTED[action]}`, () => {
			expect(deriveComposerFocusContract(action)).toBe(EXPECTED[action]);
		});
	}

	it("only returns known contracts", () => {
		for (const action of ALL_ACTIONS) {
			expect(["unconditional", "guarded", "none"]).toContain(
				deriveComposerFocusContract(action),
			);
		}
	});

	it("the composer-terminal (unconditional) set is exactly {send, stop, new-chat}", () => {
		const unconditional = ALL_ACTIONS.filter(
			(a) => deriveComposerFocusContract(a) === "unconditional",
		);
		expect(new Set(unconditional)).toEqual(
			new Set<ComposerAction>(["send", "stop", "new-chat"]),
		);
	});
});

describe("applyComposerFocus — dispatch", () => {
	function makeHandlers() {
		return {
			focusUnconditional: vi.fn(),
			focusGuarded: vi.fn(),
		};
	}

	it("routes every unconditional action to focusUnconditional only", () => {
		for (const action of ALL_ACTIONS.filter(
			(a) => EXPECTED[a] === "unconditional",
		)) {
			const h = makeHandlers();
			applyComposerFocus(action, h);
			expect(h.focusUnconditional, action).toHaveBeenCalledTimes(1);
			expect(h.focusGuarded, action).not.toHaveBeenCalled();
		}
	});

	it("routes every guarded action to focusGuarded only", () => {
		for (const action of ALL_ACTIONS.filter(
			(a) => EXPECTED[a] === "guarded",
		)) {
			const h = makeHandlers();
			applyComposerFocus(action, h);
			expect(h.focusGuarded, action).toHaveBeenCalledTimes(1);
			expect(h.focusUnconditional, action).not.toHaveBeenCalled();
		}
	});

	// I166 crux: send/stop/new-chat are unconditional, NOT guarded. A mouse
	// click on the Send button parks focus on the button (outside the composer
	// focus cluster), so a *guarded* return would read composerHadFocus=false
	// and no-op — the exact bug. This pins them to the unconditional handler.
	it("send/stop/new-chat never route to the guarded handler (I166 regression guard)", () => {
		for (const action of ["send", "stop", "new-chat"] as ComposerAction[]) {
			const h = makeHandlers();
			applyComposerFocus(action, h);
			expect(h.focusGuarded, action).not.toHaveBeenCalled();
			expect(h.focusUnconditional, action).toHaveBeenCalledTimes(1);
		}
	});
});

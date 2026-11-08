/**
 * Vertical tab rail – piano-key flyout state machine
 * ([[Agent Console Vertical Tab Rail]] § Hover flyout state machine).
 * Every cell of the spec's state × event table, plus the scenario rows.
 */
import { describe, it, expect } from "vitest";
import {
	nextRailHover,
	shouldShowFlyout,
	flyoutKey,
	isLabelCut,
	RAIL_WARM_MS,
	RAIL_COOL_MS,
	type RailHoverState,
	type RailHoverEvent,
	type RailHoverEffect,
} from "../tab-rail-hover";

const cold: RailHoverState = { kind: "cold" };
const warming: RailHoverState = { kind: "warming", key: "k" };
const showP: RailHoverState = { kind: "showing", key: "k", via: "pointer" };
const showF: RailHoverState = { kind: "showing", key: "k", via: "focus" };
const warm: RailHoverState = { kind: "warm" };
const dismP: RailHoverState = { kind: "dismissed", key: "k", via: "pointer" };
const dismF: RailHoverState = { kind: "dismissed", key: "k", via: "focus" };

const S = { cold, warming, showP, showF, warm, dismP, dismF };
type SName = keyof typeof S;

const sw = { type: "startWarm", ms: RAIL_WARM_MS } as const;
const cw = { type: "cancelWarm" } as const;
const sc = { type: "startCool", ms: RAIL_COOL_MS } as const;
const cc = { type: "cancelCool" } as const;
const rp = { type: "reposition" } as const;

type Cell = [RailHoverState | "same", RailHoverEffect[]];
const same = (fx: RailHoverEffect[] = []): Cell => ["same", fx];

const wj = (k: string): RailHoverState => ({ kind: "warming", key: k });
const sp = (k: string): RailHoverState => ({ kind: "showing", key: k, via: "pointer" });
const sf = (k: string): RailHoverState => ({ kind: "showing", key: k, via: "focus" });

const rows: Array<[string, RailHoverEvent, Record<SName, Cell>]> = [
	["pointerEnterKey(k)", { type: "pointerEnterKey", key: "k" }, {
		cold: [wj("k"), [sw]], warming: same(), showP: same(), showF: [sp("k"), []],
		warm: [sp("k"), [cc]], dismP: same(), dismF: same(),
	}],
	["pointerEnterKey(j)", { type: "pointerEnterKey", key: "j" }, {
		cold: [wj("j"), [sw]], warming: [wj("j"), [sw]], showP: [sp("j"), []], showF: [sp("j"), []],
		warm: [sp("j"), [cc]], dismP: [sp("j"), []], dismF: [sp("j"), []],
	}],
	["pointerLeaveKey", { type: "pointerLeaveKey" }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, []], showF: same(),
		warm: same(), dismP: [warm, []], dismF: same(),
	}],
	["pointerLeaveRail(outside)", { type: "pointerLeaveRail" }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, [sc]], showF: same(),
		warm: same([sc]), dismP: [warm, [sc]], dismF: [warm, [sc]],
	}],
	["pointerEnterRail", { type: "pointerEnterRail" }, {
		cold: same(), warming: same(), showP: same(), showF: same(),
		warm: same([cc]), dismP: same(), dismF: same(),
	}],
	["warmElapsed", { type: "warmElapsed" }, {
		cold: same(), warming: [sp("k"), []], showP: same(), showF: same(),
		warm: same(), dismP: same(), dismF: same(),
	}],
	["coolElapsed", { type: "coolElapsed" }, {
		cold: same(), warming: same(), showP: same(), showF: same(),
		warm: [cold, []], dismP: same(), dismF: same(),
	}],
	["focusKey(k)", { type: "focusKey", key: "k" }, {
		cold: [sf("k"), []], warming: [sf("k"), [cw]], showP: [sf("k"), []], showF: same(),
		warm: [sf("k"), [cc]], dismP: same(), dismF: same(),
	}],
	["focusKey(j)", { type: "focusKey", key: "j" }, {
		cold: [sf("j"), []], warming: [sf("j"), [cw]], showP: [sf("j"), []], showF: [sf("j"), []],
		warm: [sf("j"), [cc]], dismP: [sf("j"), []], dismF: [sf("j"), []],
	}],
	["blurKey(pointer inside)", { type: "blurKey", pointerInside: true }, {
		cold: same(), warming: same(), showP: same(), showF: [warm, []],
		warm: same(), dismP: same(), dismF: [warm, []],
	}],
	["blurKey(pointer outside)", { type: "blurKey", pointerInside: false }, {
		cold: same(), warming: same(), showP: same(), showF: [warm, [sc]],
		warm: same(), dismP: same(), dismF: [warm, [sc]],
	}],
	["escape", { type: "escape" }, {
		cold: same(), warming: [cold, [cw]], showP: [dismP, []], showF: [dismF, []],
		warm: same(), dismP: same(), dismF: same(),
	}],
	["listScrolled", { type: "listScrolled" }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, []], showF: same([rp]),
		warm: same(), dismP: same(), dismF: same(),
	}],
	["dragStarted", { type: "dragStarted" }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, []], showF: [warm, []],
		warm: same(), dismP: same(), dismF: same(),
	}],
	["menuOpened", { type: "menuOpened" }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, []], showF: [warm, []],
		warm: same(), dismP: same(), dismF: same(),
	}],
	["keysChanged(k gone)", { type: "keysChanged", keys: ["j"] }, {
		cold: same(), warming: [cold, [cw]], showP: [warm, []], showF: [warm, []],
		warm: same(), dismP: [warm, []], dismF: [warm, []],
	}],
	["keysChanged(k kept)", { type: "keysChanged", keys: ["k", "j"] }, {
		cold: same(), warming: same(), showP: same(), showF: same(),
		warm: same(), dismP: same(), dismF: same(),
	}],
];

describe("nextRailHover – full state × event table", () => {
	const cases: Array<[string, SName, RailHoverEvent, Cell]> = [];
	for (const [name, ev, cells] of rows) {
		for (const s of Object.keys(S) as SName[]) {
			cases.push([name, s, ev, cells[s]]);
		}
	}
	it.each(cases)("%s in %s", (_n, s, ev, [next, fx]) => {
		const r = nextRailHover(S[s], ev);
		expect(r.state).toEqual(next === "same" ? S[s] : next);
		expect(r.effects).toEqual(fx);
	});
});

function run(events: RailHoverEvent[], start: RailHoverState = cold) {
	let state = start;
	for (const e of events) state = nextRailHover(state, e).state;
	return state;
}

describe("scenarios", () => {
	it("a quick pass across the rail never opens a flyout", () => {
		const s = run([
			{ type: "pointerEnterRail" },
			{ type: "pointerEnterKey", key: "a" },
			{ type: "pointerLeaveKey" },
			{ type: "pointerEnterKey", key: "b" },
			{ type: "pointerLeaveKey" },
			{ type: "pointerLeaveRail" },
		]);
		expect(flyoutKey(s)).toBeNull();
	});

	it("after the first flyout, other keys show at once (piano keys)", () => {
		const s = run([
			{ type: "pointerEnterKey", key: "a" },
			{ type: "warmElapsed" },
			{ type: "pointerLeaveKey" },
			{ type: "pointerEnterKey", key: "b" },
		]);
		expect(flyoutKey(s)).toBe("b");
	});

	it("re-entering within the cool-down is instant; after it, waits again", () => {
		const shown = run([
			{ type: "pointerEnterKey", key: "a" },
			{ type: "warmElapsed" },
			{ type: "pointerLeaveKey" },
			{ type: "pointerLeaveRail" },
		]);
		expect(run([{ type: "pointerEnterRail" }, { type: "pointerEnterKey", key: "a" }], shown))
			.toEqual(sp("a"));
		expect(run([{ type: "coolElapsed" }, { type: "pointerEnterRail" }, { type: "pointerEnterKey", key: "a" }], shown))
			.toEqual(wj("a"));
	});

	it("one-tab rail: Escape, leave, re-enter → warming again", () => {
		const s = run([
			{ type: "pointerEnterKey", key: "k" },
			{ type: "warmElapsed" },
			{ type: "escape" },
			{ type: "pointerLeaveKey" },
			{ type: "pointerLeaveRail" },
			{ type: "coolElapsed" },
			{ type: "pointerEnterRail" },
			{ type: "pointerEnterKey", key: "k" },
		]);
		expect(s).toEqual(wj("k"));
	});

	it("keyboard focus shows at once, no warm-up", () => {
		expect(flyoutKey(run([{ type: "focusKey", key: "a" }]))).toBe("a");
	});

	it("the cool timer is 400ms and the warm timer 250ms", () => {
		expect(RAIL_WARM_MS).toBe(250);
		expect(RAIL_COOL_MS).toBe(400);
	});
});

describe("shouldShowFlyout", () => {
	it.each([
		["icons", false, true],
		["icons", true, true],
		["names", false, false],
		["names", true, true],
	] as const)("mode %s, truncated %s → %s", (mode, truncated, expected) => {
		expect(shouldShowFlyout({ mode, truncated })).toBe(expected);
	});
});

// I301: while the close button shows, a name that ends under it counts as cut,
// so its flyout shows. The × shows only on pointer hover (CSS :hover), so a
// keyboard-focus flyout never subtracts the overlay.
describe("isLabelCut (I301)", () => {
	const fits = { scrollWidth: 80, clientWidth: 100 };
	it("a cut-off name is cut in every case", () => {
		for (const via of ["pointer", "focus"] as const) {
			for (const width of [60, 160]) {
				expect(isLabelCut({ scrollWidth: 120, clientWidth: 100, via, width })).toBe(true);
			}
		}
	});
	it("a name that fits but ends under the × is cut on pointer hover at 100 px+", () => {
		expect(isLabelCut({ ...fits, via: "pointer", width: 160 })).toBe(true);
		expect(isLabelCut({ ...fits, via: "pointer", width: 100 })).toBe(true);
	});
	it("…but not for a keyboard-focus flyout", () => {
		expect(isLabelCut({ ...fits, via: "focus", width: 160 })).toBe(false);
	});
	it("…and not below 100 px, where there is no ×", () => {
		expect(isLabelCut({ ...fits, via: "pointer", width: 99 })).toBe(false);
	});
	it("a name that ends left of the overlay is not cut", () => {
		expect(isLabelCut({ scrollWidth: 40, clientWidth: 100, via: "pointer", width: 160 })).toBe(false);
	});
});

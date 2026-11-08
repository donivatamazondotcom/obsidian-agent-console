/**
 * Vertical tab rail settings at the trust boundary
 * ([[Agent Console Vertical Tab Rail]] § Setting, § Persisted width).
 *
 * - `tabDisplay` missing → horizontal with no log (existing installs keep the
 *   top strip); junk → horizontal and logged.
 * - Widths are whole pixels: `tabRailWidth` is 32 or 60..260,
 *   `tabRailNamedWidth` is 60..260. Anything else present is logged and
 *   replaced by the default – never clamped into range silently.
 * - A saved width survives save → load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../utils/logger", () => ({
	getLogger: () => ({
		warn,
		log: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import { normalizeRawSettings, DEFAULT_SETTINGS } from "../settings-normalizer";

const idKey = (
	_d: string,
	_f: string,
	current: string,
	_l: string,
	_label: string,
) => current;

const load = (raw: Record<string, unknown>) =>
	normalizeRawSettings(raw, DEFAULT_SETTINGS, idKey);

const warnedAbout = (key: string) =>
	warn.mock.calls.some((c) => String(c[0]).includes(key));

beforeEach(() => warn.mockClear());

describe("tabDisplay", () => {
	it("defaults to horizontal with no log when missing", () => {
		expect(load({}).tabDisplay).toBe("horizontal");
		expect(warnedAbout("tabDisplay")).toBe(false);
	});
	it("keeps both valid values", () => {
		expect(load({ tabDisplay: "vertical" }).tabDisplay).toBe("vertical");
		expect(load({ tabDisplay: "horizontal" }).tabDisplay).toBe("horizontal");
	});
	it.each(["sideways", 1, true, null, {}])("junk %o → horizontal, logged", (raw) => {
		expect(load({ tabDisplay: raw }).tabDisplay).toBe("horizontal");
		expect(warnedAbout("tabDisplay")).toBe(true);
	});
});

describe("tabRailWidth", () => {
	it("defaults to 32 (icon-only) with no log", () => {
		expect(load({}).tabRailWidth).toBe(32);
		expect(warnedAbout("tabRailWidth")).toBe(false);
	});
	it.each([32, 60, 148, 260])("keeps %s", (w) => {
		expect(load({ tabRailWidth: w }).tabRailWidth).toBe(w);
		expect(warnedAbout("tabRailWidth")).toBe(false);
	});
	it.each([147.5, 45, 59, 261, 300, 0, -1, NaN, "150", null])(
		"invalid %o → default, logged",
		(raw) => {
			expect(load({ tabRailWidth: raw }).tabRailWidth).toBe(32);
			expect(warnedAbout("tabRailWidth")).toBe(true);
		},
	);
});

describe("tabRailNamedWidth", () => {
	it("defaults to 160 with no log", () => {
		expect(load({}).tabRailNamedWidth).toBe(160);
		expect(warnedAbout("tabRailNamedWidth")).toBe(false);
	});
	it.each([60, 160, 260])("keeps %s", (w) => {
		expect(load({ tabRailNamedWidth: w }).tabRailNamedWidth).toBe(w);
	});
	it.each([32, 147.5, 261, "x"])("invalid %o → default, logged", (raw) => {
		expect(load({ tabRailNamedWidth: raw }).tabRailNamedWidth).toBe(160);
		expect(warnedAbout("tabRailNamedWidth")).toBe(true);
	});
});

describe("round trip", () => {
	it("a dragged width and the vertical display survive save → load", () => {
		const saved = { ...load({}), tabDisplay: "vertical", tabRailWidth: 148, tabRailNamedWidth: 148 };
		const reloaded = load(JSON.parse(JSON.stringify(saved)) as Record<string, unknown>);
		expect(reloaded.tabDisplay).toBe("vertical");
		expect(reloaded.tabRailWidth).toBe(148);
		expect(reloaded.tabRailNamedWidth).toBe(148);
	});
});

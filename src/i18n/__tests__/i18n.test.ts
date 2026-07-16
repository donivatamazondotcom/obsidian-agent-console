import { describe, it, expect, afterEach } from "vitest";
import {
	t,
	initLocale,
	resolveLocale,
	resetLocaleForTests,
	SUPPORTED_LOCALES,
	LOCALE_DISPLAY_NAMES,
	LANGUAGE_SETTING_VALUES,
} from "../index";
import { en } from "../en";
import { ko } from "../ko";

/**
 * i18n boundary tests ([[Agent Console I18N]] slice 1).
 *
 * Boundary honesty (R2): tests enter through the public API — initLocale +
 * t() — the same seam plugin.ts and SettingsTab use. Outcome assertions
 * (R3): rendered strings, not internals.
 */

afterEach(() => {
	resetLocaleForTests();
});

describe("resolveLocale", () => {
	it("returns an exact supported match", () => {
		expect(resolveLocale("ko")).toBe("ko");
		expect(resolveLocale("en")).toBe("en");
	});

	it("maps a regional tag to its base language (ko-KR → ko)", () => {
		expect(resolveLocale("ko-KR")).toBe("ko");
	});

	it("falls back to English for unsupported languages", () => {
		expect(resolveLocale("fr")).toBe("en");
		expect(resolveLocale("zh-TW")).toBe("en");
		expect(resolveLocale("")).toBe("en");
	});
});

describe("t — English (default)", () => {
	it("returns the English string before any initLocale call", () => {
		expect(t("settings.debugMode.name")).toBe("Debug mode");
	});

	it("interpolates {placeholder} params", () => {
		expect(t("settings.fontSize.desc", { min: 10, max: 30 })).toBe(
			"Adjust the font size of the chat message area (10-30px).",
		);
	});

	it("leaves unmatched placeholders visible instead of throwing", () => {
		expect(t("settings.fontSize.desc", { min: 10 })).toBe(
			"Adjust the font size of the chat message area (10-{max}px).",
		);
		expect(t("settings.fontSize.desc")).toBe(
			"Adjust the font size of the chat message area ({min}-{max}px).",
		);
	});
});

describe("t — Korean active", () => {
	it("returns the Korean string for a translated key", () => {
		initLocale("ko");
		expect(t("settings.debugMode.name")).toBe("디버그 모드");
	});

	it("falls back to English for a key Korean does not translate", () => {
		initLocale("ko");
		// Literal command placeholder — intentionally untranslated.
		expect(t("settings.path.placeholder")).toBe("gemini");
	});

	it("interpolates params inside Korean strings", () => {
		initLocale("ko");
		expect(t("settings.fontSize.desc", { min: 10, max: 30 })).toBe(
			"채팅 메시지 영역의 글꼴 크기를 조절합니다(10-30px).",
		);
	});
});

describe("initLocale", () => {
	it('"auto" follows the app language (stub: en)', () => {
		initLocale("auto");
		expect(t("settings.debugMode.name")).toBe("Debug mode");
	});

	it("an explicit override wins over the app language", () => {
		initLocale("ko");
		expect(t("settings.heading.tabs")).toBe("탭");
	});

	it("an unknown stored value degrades to English, never throws", () => {
		initLocale("klingon" as string);
		expect(t("settings.debugMode.name")).toBe("Debug mode");
	});
});

describe("catalog integrity", () => {
	it("every Korean key exists in the English contract (no orphans)", () => {
		const enKeys = new Set(Object.keys(en));
		const orphans = Object.keys(ko()).filter((k) => !enKeys.has(k));
		expect(orphans).toEqual([]);
	});

	it("no catalog value is empty in a locale when English is non-empty", () => {
		const koCatalog = ko();
		const empty = Object.entries(koCatalog).filter(
			([k, v]) =>
				v?.trim() === "" && en[k as keyof typeof en].trim() !== "",
		);
		expect(empty).toEqual([]);
	});

	it("reports Korean coverage of the settings surface (informational)", () => {
		const total = Object.keys(en).length;
		const covered = Object.keys(ko()).length;
		// Literal placeholders are intentionally untranslated; coverage
		// floor guards against an accidentally-truncated catalog.
		expect(covered / total).toBeGreaterThan(0.8);
	});

	it("every supported locale has a display name and a setting value", () => {
		for (const locale of SUPPORTED_LOCALES) {
			expect(LOCALE_DISPLAY_NAMES[locale]).toBeTruthy();
			expect(LANGUAGE_SETTING_VALUES).toContain(locale);
		}
		expect(LANGUAGE_SETTING_VALUES).toContain("auto");
	});
});

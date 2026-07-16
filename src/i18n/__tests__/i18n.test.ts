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
import { zh } from "../zh";
import { ja } from "../ja";

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
		expect(resolveLocale("ja-JP")).toBe("ja");
	});

	it("maps Chinese regional tags to the shipped zh catalog", () => {
		// Obsidian reports zh / zh-TW; base-language match routes both to
		// the Simplified catalog (closer than English for zh-TW users).
		expect(resolveLocale("zh")).toBe("zh");
		expect(resolveLocale("zh-CN")).toBe("zh");
		expect(resolveLocale("zh-TW")).toBe("zh");
	});

	it("falls back to English for unsupported languages", () => {
		expect(resolveLocale("fr")).toBe("en");
		expect(resolveLocale("de")).toBe("en");
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

describe("t — Chinese active", () => {
	it("returns the Chinese string for a translated key", () => {
		initLocale("zh");
		expect(t("settings.debugMode.name")).toBe("调试模式");
	});

	it("falls back to English for a key Chinese does not translate", () => {
		initLocale("zh");
		// Literal command placeholder — intentionally untranslated.
		expect(t("settings.path.placeholder")).toBe("gemini");
	});

	it("interpolates params inside Chinese strings", () => {
		initLocale("zh");
		expect(t("settings.fontSize.desc", { min: 10, max: 30 })).toBe(
			"调整聊天消息区域的字体大小（10-30px）。",
		);
	});
});

describe("t — Japanese active", () => {
	it("returns the Japanese string for a translated key", () => {
		initLocale("ja");
		expect(t("settings.debugMode.name")).toBe("デバッグモード");
	});

	it("falls back to English for a key Japanese does not translate", () => {
		initLocale("ja");
		// Literal command placeholder — intentionally untranslated.
		expect(t("settings.path.placeholder")).toBe("gemini");
	});

	it("interpolates params inside Japanese strings", () => {
		initLocale("ja");
		expect(t("settings.fontSize.desc", { min: 10, max: 30 })).toBe(
			"チャットメッセージ領域のフォントサイズを調整します（10〜30px）。",
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

const NON_ENGLISH_CATALOGS = { ko, zh, ja } as const;

describe.each(Object.entries(NON_ENGLISH_CATALOGS))(
	"catalog integrity — %s",
	(_name, factory) => {
		it("every key exists in the English contract (no orphans)", () => {
			const enKeys = new Set(Object.keys(en));
			const orphans = Object.keys(factory()).filter(
				(k) => !enKeys.has(k),
			);
			expect(orphans).toEqual([]);
		});

		it("no catalog value is empty where English is non-empty", () => {
			const catalog = factory();
			const empty = Object.entries(catalog).filter(
				([k, v]) =>
					v?.trim() === "" &&
					en[k as keyof typeof en].trim() !== "",
			);
			expect(empty).toEqual([]);
		});

		it("covers the settings surface (coverage floor)", () => {
			const total = Object.keys(en).length;
			const covered = Object.keys(factory()).length;
			// Literal placeholders are intentionally untranslated; the
			// floor guards against an accidentally-truncated catalog.
			expect(covered / total).toBeGreaterThan(0.8);
		});

		it("interpolation placeholders match the English contract", () => {
			// A translation must keep every {token} its English source has
			// (missing tokens silently drop runtime data from the UI).
			const catalog = factory();
			const mismatches = Object.entries(catalog).filter(([k, v]) => {
				const enTokens = new Set(
					en[k as keyof typeof en].match(/\{\w+\}/g) ?? [],
				);
				const locTokens = new Set(v?.match(/\{\w+\}/g) ?? []);
				return (
					enTokens.size !== locTokens.size ||
					[...enTokens].some((t2) => !locTokens.has(t2))
				);
			});
			expect(mismatches.map(([k]) => k)).toEqual([]);
		});
	},
);

describe("catalog integrity — cross-locale", () => {

	it("every supported locale has a display name and a setting value", () => {
		for (const locale of SUPPORTED_LOCALES) {
			expect(LOCALE_DISPLAY_NAMES[locale]).toBeTruthy();
			expect(LANGUAGE_SETTING_VALUES).toContain(locale);
		}
		expect(LANGUAGE_SETTING_VALUES).toContain("auto");
	});
});

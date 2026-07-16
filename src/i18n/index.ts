/**
 * Internationalization (i18n) boundary.
 *
 * Single locale-aware edge for all user-facing strings, following the
 * "normalize variance once at the edge" pattern (utils/platform.ts).
 * Consumers call t(key, params) and never branch on locale inline.
 *
 * - `en` is the canonical catalog; its keys are the contract.
 * - Other locales are partial: any missing key falls back to English,
 *   so a lagging translation never breaks the UI.
 * - Non-English catalogs are factory-wrapped and instantiated only when
 *   active — a user pays resident memory for exactly one locale.
 * - The active locale resolves once at plugin load (initLocale). Language
 *   follows Obsidian's app language (getLanguage, Obsidian 1.8.7+) unless
 *   the user sets a manual override in Advanced settings.
 *
 * See vault spec: 04-initiatives/Agent Console/Agent Console I18N.md
 */
import { getLanguage } from "obsidian";
import { en } from "./en";
import { ko } from "./ko";

/** A key into the canonical English catalog. */
export type TranslationKey = keyof typeof en;

/** A (possibly partial) locale catalog keyed by the English contract. */
export type LocaleCatalog = Partial<Record<TranslationKey, string>>;

/**
 * Locales the plugin ships. English is the baseline; the rest grow here
 * as catalogs land (spec Decision 3: ko, zh, ja, de, es, fr, pt-BR).
 */
export const SUPPORTED_LOCALES = ["en", "ko"] as const;
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

/** Valid values for the `language` setting ("auto" = follow Obsidian). */
export const LANGUAGE_SETTING_VALUES = [
	"auto",
	...SUPPORTED_LOCALES,
] as const;
export type LanguageSetting = (typeof LANGUAGE_SETTING_VALUES)[number];

/**
 * Display names for the language dropdown, in each language's own script
 * (endonyms — the convention for language pickers).
 */
export const LOCALE_DISPLAY_NAMES: Record<LocaleCode, string> = {
	en: "English",
	ko: "한국어",
};

/**
 * Factories for non-English catalogs. Wrapping in a function defers object
 * instantiation until the locale is actually active.
 */
const localeFactories: Record<Exclude<LocaleCode, "en">, () => LocaleCatalog> =
	{
		ko,
	};

/** Active non-English catalog, or null when English is active. */
let activeCatalog: LocaleCatalog | null = null;

/**
 * Map a raw language tag (from getLanguage() or the setting) to a shipped
 * locale. Exact match first, then base-language match ("pt-BR" → "pt"),
 * else English.
 */
export function resolveLocale(raw: string): LocaleCode {
	const supported = SUPPORTED_LOCALES as readonly string[];
	if (supported.includes(raw)) {
		return raw as LocaleCode;
	}
	const base = raw.split("-")[0];
	if (supported.includes(base)) {
		return base as LocaleCode;
	}
	return "en";
}

/**
 * Resolve and activate the display locale. Call once at plugin load (after
 * settings load, before views/commands register), and again if the user
 * changes the language setting (already-rendered surfaces and command
 * names refresh fully on the next app reload).
 */
export function initLocale(language: string): void {
	const tag = language === "auto" ? getLanguage() : language;
	const locale = resolveLocale(tag);
	activeCatalog =
		locale === "en" ? null : (localeFactories[locale]?.() ?? null);
}

/** Test-only: reset to English without going through initLocale. */
export function resetLocaleForTests(): void {
	activeCatalog = null;
}

/**
 * Interpolate {placeholder} tokens. A token with no matching param is left
 * as-is (never throws) so a catalog typo degrades visibly but safely.
 */
function interpolate(
	template: string,
	params: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in params ? String(params[name]) : match,
	);
}

/**
 * Translate a key. Falls back to English when the active locale lacks the
 * key. Optional params fill {placeholder} tokens.
 */
export function t(
	key: TranslationKey,
	params?: Record<string, string | number>,
): string {
	const template = activeCatalog?.[key] ?? en[key];
	return params ? interpolate(template, params) : template;
}

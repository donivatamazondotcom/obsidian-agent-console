/**
 * "What's new" highlights registry (I300). Data only: add one entry per
 * release that has something worth telling existing users about. Strings
 * live in `i18n/en.ts`; other locales fall back to English.
 */
import type { WhatsNewHighlight } from "../resolvers/whats-new";

/** The first release with a highlight. Users from before it see from here. */
export const FIRST_TRACKED = "2.5.0";

export const HIGHLIGHTS: readonly WhatsNewHighlight[] = [
	{
		id: "vertical-tabs",
		version: "2.5.0",
		titleKey: "chat.whatsNew.verticalTabs.title",
		bodyKey: "chat.whatsNew.verticalTabs.body",
		action: { kind: "toggleTabDisplay" },
	},
];

/**
 * "What's new" card decisions (I300).
 *
 * Every version here is a release core: `major.minor.patch`, prerelease
 * dropped, so a beta user is treated as on the release it leads to and a
 * dismiss on the beta covers the stable release.
 */
import * as semver from "semver";
import type { TranslationKey } from "../i18n";
import { FIRST_TRACKED } from "../whats-new/highlights";

/** A closed set of things a highlight's button can do. Data, not callbacks. */
export type WhatsNewAction = { kind: "toggleTabDisplay" };

export interface WhatsNewHighlight {
	id: string;
	/** Release core of the version that shipped the feature. */
	version: string;
	titleKey: TranslationKey;
	bodyKey: TranslationKey;
	action?: WhatsNewAction;
}

/** At most this many highlights show at once (internal, not a setting). */
const MAX_SHOWN = 3;

const RELEASES_URL =
	"https://github.com/donivatamazondotcom/obsidian-agent-console/releases/tag/";

/** `major.minor.patch` of a version, or undefined if it isn't semver. */
export function releaseCore(v: string | undefined | null): string | undefined {
	if (typeof v !== "string" || v === "") return undefined;
	const parsed = semver.parse(semver.clean(v) ?? v);
	if (!parsed) return undefined;
	return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * The highlights to show, newest first, at most three.
 *
 * Not forced: versions after `lastSeen` up to and including `current`. An
 * undefined `lastSeen` is an existing user from before this feature, so the
 * window starts at `FIRST_TRACKED` inclusive – going straight from 2.4 to 2.6
 * still shows the 2.5 entry. Forced (the command): everything up to
 * `current`, ignoring `lastSeen`.
 */
export function deriveWhatsNewHighlights(input: {
	highlights: readonly WhatsNewHighlight[];
	current: string;
	lastSeen: string | undefined;
	forced: boolean;
}): WhatsNewHighlight[] {
	const { highlights, current, lastSeen, forced } = input;
	const inWindow = (v: string): boolean => {
		if (semver.gt(v, current)) return false;
		if (forced) return true;
		if (lastSeen === undefined) return semver.gte(v, FIRST_TRACKED);
		return semver.gt(v, lastSeen);
	};
	return highlights
		.filter((h) => inWindow(h.version))
		.sort((a, b) => semver.rcompare(a.version, b.version))
		.slice(0, MAX_SHOWN);
}

/** Release notes for a version's release core (tags have no `v` prefix). */
export function releaseNotesUrl(version: string): string | undefined {
	const core = releaseCore(version);
	return core === undefined ? undefined : `${RELEASES_URL}${core}`;
}

/** What a dismiss stores: the higher of the two, so a downgrade never lowers it. */
export function nextLastSeenVersion(
	lastSeen: string | undefined,
	current: string,
): string {
	if (lastSeen === undefined) return current;
	return semver.gt(lastSeen, current) ? lastSeen : current;
}

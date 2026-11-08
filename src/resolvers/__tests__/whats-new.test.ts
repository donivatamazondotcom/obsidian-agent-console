/**
 * I300: which "What's new" highlights show, and the release-notes link.
 * Inputs to the resolver are release cores; `releaseCore` makes them.
 */
import { describe, it, expect } from "vitest";
import {
	deriveWhatsNewHighlights,
	releaseCore,
	releaseNotesUrl,
	nextLastSeenVersion,
	type WhatsNewHighlight,
} from "../whats-new";
import { FIRST_TRACKED, HIGHLIGHTS } from "../../whats-new/highlights";

const h = (id: string, version: string): WhatsNewHighlight => ({
	id,
	version,
	titleKey: "chat.whatsNew.verticalTabs.title",
	bodyKey: "chat.whatsNew.verticalTabs.body",
});

const VT = h("vertical-tabs", "2.5.0");
const ids = (xs: WhatsNewHighlight[]) => xs.map((x) => x.id);
const run = (
	highlights: readonly WhatsNewHighlight[],
	current: string,
	lastSeen: string | undefined,
	forced = false,
) =>
	ids(
		deriveWhatsNewHighlights({
			highlights,
			current: releaseCore(current)!,
			lastSeen,
			forced,
			firstTracked: FIRST_TRACKED,
		}),
	);

describe("I300 releaseCore", () => {
	it("drops the prerelease and normalizes", () => {
		expect(releaseCore("2.5.0-beta.1")).toBe("2.5.0");
		expect(releaseCore("v2.5.0")).toBe("2.5.0");
		expect(releaseCore("2.4.0")).toBe("2.4.0");
	});
	it("returns undefined for anything that isn't semver", () => {
		expect(releaseCore("x")).toBeUndefined();
		expect(releaseCore("")).toBeUndefined();
		expect(releaseCore(undefined)).toBeUndefined();
	});
});

describe("I300 deriveWhatsNewHighlights", () => {
	it("already dismissed this version → none", () => {
		expect(run([VT], "2.5.0", "2.5.0")).toEqual([]);
	});
	it("an existing user from before the feature → vertical-tabs", () => {
		expect(run([VT], "2.5.0", undefined)).toEqual(["vertical-tabs"]);
	});
	it("skipping 2.5 straight to 2.6 still shows the 2.5 entry, newest first", () => {
		expect(run([VT, h("b", "2.6.0")], "2.6.0", undefined)).toEqual([
			"b",
			"vertical-tabs",
		]);
	});
	it("a beta user (current cored to 2.5.0) sees it", () => {
		expect(run([VT], "2.5.0-beta.1", "2.4.0")).toEqual(["vertical-tabs"]);
	});
	it("a dismiss on the beta covers stable", () => {
		expect(run([VT], "2.5.0", releaseCore("2.5.0-beta.1"))).toEqual([]);
	});
	it("entries newer than the running version don't show", () => {
		expect(run([VT, h("b", "2.6.0")], "2.5.0", "2.4.0")).toEqual([
			"vertical-tabs",
		]);
	});
	it("skipped versions: newest first, at most 3", () => {
		const reg = [VT, h("b", "2.6.0"), h("c", "2.7.0"), h("d", "2.8.0")];
		expect(run(reg, "2.8.0", "2.4.0")).toEqual(["d", "c", "b"]);
	});
	it("forced ignores lastSeen", () => {
		expect(run([VT], "2.5.0", "2.5.0", true)).toEqual(["vertical-tabs"]);
	});
	it("forced still hides entries newer than the running version", () => {
		expect(run([h("b", "2.6.0")], "2.5.0", undefined, true)).toEqual([]);
	});
	it("the shipped registry carries the vertical-tabs entry for 2.5.0", () => {
		expect(run(HIGHLIGHTS, "2.5.0", undefined)).toEqual(["vertical-tabs"]);
		expect(HIGHLIGHTS[0].action).toEqual({ kind: "toggleTabDisplay" });
	});
});

describe("I300 releaseNotesUrl", () => {
	it("links the release core's tag, no v prefix", () => {
		expect(releaseNotesUrl("2.5.0-beta.1")).toBe(
			"https://github.com/donivatamazondotcom/obsidian-agent-console/releases/tag/2.5.0",
		);
	});
	it("returns undefined for an invalid version", () => {
		expect(releaseNotesUrl("nope")).toBeUndefined();
	});
});

describe("I300 nextLastSeenVersion", () => {
	it("never lowers the stored version on a downgrade", () => {
		expect(nextLastSeenVersion("2.6.0", "2.5.0")).toBe("2.6.0");
	});
	it("raises it to the current version", () => {
		expect(nextLastSeenVersion("2.4.0", "2.5.0")).toBe("2.5.0");
		expect(nextLastSeenVersion(undefined, "2.5.0")).toBe("2.5.0");
	});
});

describe("I300 the resolver is total (review F1)", () => {
	it("skips a registry entry whose version isn't a release core", () => {
		expect(
			run(
				[VT, h("typo", "2.6"), h("pre", "2.5.0-beta.1")],
				"2.6.0",
				undefined,
			),
		).toEqual(["vertical-tabs"]);
	});
	it("reads an invalid lastSeen as undefined", () => {
		expect(run([VT], "2.5.0", "garbage")).toEqual(["vertical-tabs"]);
	});
	it("an invalid current shows nothing and doesn't throw", () => {
		expect(
			deriveWhatsNewHighlights({
				highlights: [VT],
				current: "nope",
				lastSeen: undefined,
				forced: true,
				firstTracked: FIRST_TRACKED,
			}),
		).toEqual([]);
	});
	it("nextLastSeenVersion ignores an invalid stored value and refuses an invalid current", () => {
		expect(nextLastSeenVersion("garbage", "2.5.0")).toBe("2.5.0");
		expect(nextLastSeenVersion("2.4.0", "nope")).toBeUndefined();
	});
});

describe("I300 the shipped registry is valid (review F1)", () => {
	it("every entry is a release core at or after FIRST_TRACKED, with a unique id", () => {
		const seen = new Set<string>();
		for (const e of HIGHLIGHTS) {
			expect(releaseCore(e.version)).toBe(e.version);
			expect(
				deriveWhatsNewHighlights({
					highlights: [e],
					current: e.version,
					lastSeen: undefined,
					forced: false,
					firstTracked: FIRST_TRACKED,
				}),
			).toHaveLength(1);
			expect(seen.has(e.id)).toBe(false);
			seen.add(e.id);
		}
	});
});

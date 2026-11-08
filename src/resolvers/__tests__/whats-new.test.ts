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
import { HIGHLIGHTS } from "../../whats-new/highlights";

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

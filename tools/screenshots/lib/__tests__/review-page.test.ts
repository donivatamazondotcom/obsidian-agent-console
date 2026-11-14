/**
 * The side-by-side review page a run writes: the committed image next to the
 * new one, per entry, so re-baselined shots are approved by eye.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Parity.
 */
import { describe, it, expect, vi } from "vitest";
import { buildReviewPage, collectReviewItems, restoreHints, type ReviewItem } from "../review-page";
import type { ManifestEntry } from "../manifest";

const png = (s: string) => Buffer.from(s);
const entry = (name: string, o: Partial<ManifestEntry> = {}): ManifestEntry => ({ name, width: 10, height: 10, crop: { x: 0, y: 0, width: 10, height: 10 }, ...o });

describe("collectReviewItems", () => {
	it("pairs each run entry's committed image with the file the run wrote, in run order", () => {
		const readCommitted = vi.fn((rel: string) => (rel.endsWith("b.webp") ? null : png(`old ${rel}`)));
		const readCurrent = vi.fn((rel: string) => png(`new ${rel}`));
		const readBeforeRun = vi.fn((rel: string) => (rel.endsWith("b.webp") ? null : png(`old ${rel}`)));
		const items = collectReviewItems(
			[entry("a"), entry("b"), entry("gif", { animation: { fps: 1, maxBytes: 1, frames: [{ holdMs: 1 }] } }), entry("c"), entry("d")],
			[
				{ name: "a", success: true },
				{ name: "b", success: true },
				{ name: "gif", success: true },
				{ name: "c", success: false, error: "content guard: blank" },
				{ name: "d", success: true, skipped: "isolated only" },
			],
			{ readCommitted, readCurrent, readBeforeRun },
		);
		expect(items.map((i) => [i.name, i.status])).toEqual([
			["a", "captured"],
			["b", "captured"],
			["gif", "captured"],
			["c", "failed"],
			["d", "skipped"],
		]);
		expect(items[0].before?.data.toString()).toBe("old docs/public/images/a.webp");
		expect(items[0].after?.data.toString()).toBe("new docs/public/images/a.webp");
		expect(items[1].before).toBeNull();
		expect(items[2].after?.mime).toBe("image/gif");
		expect(items[2].after?.data.toString()).toBe("new docs/public/images/gif.gif");
		// A failed or skipped entry shows what is on disk only when it differs from HEAD.
		expect(items[3].detail).toBe("content guard: blank");
		expect(items[3].fileChange).toBe("rewritten");
		expect(items[3].after?.data.toString()).toBe("new docs/public/images/c.webp");
		expect(items[4].fileChange).toBe("rewritten");
		expect(items[0].fileChange).toBeUndefined();
	});
});

describe("collectReviewItems — a failed entry's image file (review rounds 1–2)", () => {
	// head: the committed image; before: on disk before the run; now: on disk after.
	const io = (files: Record<string, { head?: string | null; before?: string | null; now?: string | null }>) => {
		const get = (rel: string, k: "head" | "before" | "now") => {
			const f = files[rel] ?? {};
			const v = f[k] === undefined ? (k === "head" ? `old ${rel}` : f.before === undefined ? `old ${rel}` : f.before) : f[k];
			return v === null || v === undefined ? null : png(v);
		};
		return { readCommitted: (rel: string) => get(rel, "head"), readBeforeRun: (rel: string) => get(rel, "before"), readCurrent: (rel: string) => get(rel, "now") };
	};
	const R = (n: string) => `docs/public/images/${n}.webp`;

	it("flags only files this run deleted, rewrote or added, with what is on disk now", () => {
		const items = collectReviewItems(
			[entry("gone"), entry("changed"), entry("intact"), entry("brand-new")],
			[
				{ name: "gone", success: false, error: "content guard" },
				{ name: "changed", success: false, error: "viewport" },
				{ name: "intact", success: false, error: "timeout" },
				{ name: "brand-new", success: false, error: "restore" },
			],
			io({ [R("gone")]: { now: null }, [R("changed")]: { now: "half-written" }, [R("brand-new")]: { head: null, before: null, now: "fresh" } }),
		);
		expect(items.map((i) => i.fileChange)).toEqual(["deleted", "rewritten", undefined, "added"]);
		expect(items[1].after?.data.toString()).toBe("half-written");
		expect(items[3].after?.data.toString()).toBe("fresh");
		expect(items[0].after).toBeNull();
		expect(items[2].after).toBeNull();
		expect(restoreHints(items)).toEqual({ restore: [R("gone"), R("changed")], remove: [R("brand-new")] });
	});

	it("doesn't tell you to discard a change an earlier run made, but still shows it", () => {
		const items = collectReviewItems(
			[entry("menu"), entry("flaky")],
			[
				{ name: "menu", success: true, skipped: "isolated driver only" },
				{ name: "flaky", success: false, error: "timeout" },
			],
			io({ [R("menu")]: { before: "earlier run", now: "earlier run" }, [R("flaky")]: { before: "earlier run", now: "earlier run" } }),
		);
		expect(items.map((i) => i.fileChange)).toEqual([undefined, undefined]);
		expect(items.map((i) => i.differsFromHead)).toEqual([true, true]);
		expect(items[0].after?.data.toString()).toBe("earlier run");
		expect(restoreHints(items)).toEqual({ restore: [], remove: [] });
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		const summary = html.slice(0, html.indexOf('id="menu"'));
		expect(summary).toContain('href="#menu"');
		expect(html).toMatch(/id="menu"[\s\S]*differs from the committed one since before this run/);
	});

	it("labels a deleted image on the page, with the restore command", () => {
		const items = collectReviewItems([entry("gone")], [{ name: "gone", success: false, error: "content guard" }], io({ [R("gone")]: { now: null } }));
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		expect(html).toMatch(/id="gone"[\s\S]*This run deleted the committed image[\s\S]*git restore docs\/public\/images\/gone\.webp/);
	});
});

describe("buildReviewPage", () => {
	const img = (s: string, mime = "image/webp") => ({ mime, data: png(s) });
	const items: ReviewItem[] = [
		{ name: "same", status: "captured", before: img("x"), after: img("x") },
		{ name: "moved", status: "captured", before: img("x"), after: img("y") },
		{ name: "fresh", status: "captured", before: null, after: img("z") },
		{ name: "broke", status: "failed", detail: "boom <b>", before: img("x"), after: null },
	];

	it("embeds both images as data URIs, so the page stands alone", () => {
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		expect(html).toContain(`src="data:image/webp;base64,${png("x").toString("base64")}"`);
		expect(html).toContain(`src="data:image/webp;base64,${png("y").toString("base64")}"`);
		expect(html).not.toMatch(/src="(?!data:)/);
	});

	it("labels each entry unchanged, changed, new or failed", () => {
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		const label = (name: string) => new RegExp(`id="${name}"[\\s\\S]*?class="badge[^"]*">([a-z]+)<`).exec(html)?.[1];
		expect(label("same")).toBe("unchanged");
		expect(label("moved")).toBe("changed");
		expect(label("fresh")).toBe("new");
		expect(label("broke")).toBe("failed");
	});

	it("lists the entries to review at the top, linking to each", () => {
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		const summary = html.slice(0, html.indexOf('id="same"'));
		expect(summary).toContain('href="#moved"');
		expect(summary).toContain('href="#fresh"');
		expect(summary).toContain('href="#broke"');
		expect(summary).not.toContain('href="#same"');
	});

	it("escapes names and error text", () => {
		const html = buildReviewPage([{ name: "a<b", status: "failed", detail: "boom <b>", before: null, after: null }], { title: "<t>", generated: "now" });
		expect(html).toContain("boom &lt;b&gt;");
		expect(html).toContain("a&lt;b");
		expect(html).toContain("&lt;t&gt;");
		expect(html).not.toContain("<b>");
	});
});

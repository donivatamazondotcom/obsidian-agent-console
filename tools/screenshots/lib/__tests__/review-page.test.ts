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
		const items = collectReviewItems(
			[entry("a"), entry("b"), entry("gif", { animation: { fps: 1, maxBytes: 1, frames: [{ holdMs: 1 }] } }), entry("c"), entry("d")],
			[
				{ name: "a", success: true },
				{ name: "b", success: true },
				{ name: "gif", success: true },
				{ name: "c", success: false, error: "content guard: blank" },
				{ name: "d", success: true, skipped: "isolated only" },
			],
			{ readCommitted, readCurrent },
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
		expect(items[0].fileChange).toBeUndefined();
	});
});

describe("collectReviewItems — a failed entry's image file (review round 1)", () => {
	const io = (onDisk: Record<string, string | null>) => ({
		readCommitted: (rel: string) => png(`old ${rel}`),
		readCurrent: (rel: string) => (onDisk[rel] === undefined ? png(`old ${rel}`) : onDisk[rel] === null ? null : png(onDisk[rel] as string)),
	});
	it("says when a failed entry deleted or rewrote the committed image, and shows what is on disk", () => {
		const items = collectReviewItems(
			[entry("gone"), entry("changed"), entry("intact")],
			[
				{ name: "gone", success: false, error: "content guard" },
				{ name: "changed", success: false, error: "viewport" },
				{ name: "intact", success: false, error: "timeout" },
			],
			io({ "docs/public/images/gone.webp": null, "docs/public/images/changed.webp": "half-written" }),
		);
		expect(items.map((i) => i.fileChange)).toEqual(["deleted", "rewritten", undefined]);
		expect(items[1].after?.data.toString()).toBe("half-written");
		expect(items[0].after).toBeNull();
		expect(items[2].after).toBeNull();
		expect(restoreHints(items)).toEqual(["docs/public/images/gone.webp", "docs/public/images/changed.webp"]);
	});

	it("labels such an entry on the page, so its file change is never staged unseen", () => {
		const items = collectReviewItems([entry("gone")], [{ name: "gone", success: false, error: "content guard" }], io({ "docs/public/images/gone.webp": null }));
		const html = buildReviewPage(items, { title: "t", generated: "now" });
		expect(html).toMatch(/id="gone"[\s\S]*committed image is missing on disk, but this run didn't capture it[\s\S]*git restore docs\/public\/images\/gone\.webp/);
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

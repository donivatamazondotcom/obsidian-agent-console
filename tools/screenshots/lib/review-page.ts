/**
 * Side-by-side review page for a screenshot run: the committed image next to
 * the one the run wrote, per entry. There is no pixel-diff approval test
 * (out of scope, F02), so re-baselined shots are approved by eye here.
 *
 * The page is one self-contained HTML file (images as data URIs), so it
 * opens from anywhere and never shows a stale cached image.
 *
 * Spec: [[Agent Console Isolated Screenshot Capture]] § Parity.
 * Tests: tools/screenshots/lib/__tests__/review-page.test.ts.
 */
import path from "node:path";
import type { ManifestEntry } from "./manifest";

export interface ReviewImage {
	mime: string;
	data: Buffer;
}

export interface ReviewItem {
	name: string;
	status: "captured" | "failed" | "skipped";
	/** The error or skip reason. */
	detail?: string;
	/** The committed image (git HEAD), or null when the entry is new. */
	before: ReviewImage | null;
	/**
	 * The image the run wrote. For an entry that didn't capture, what is on
	 * disk when it differs from the committed image, else null.
	 */
	after: ReviewImage | null;
	/**
	 * An entry this run didn't capture whose image file this run deleted,
	 * rewrote, or wrote without a committed image.
	 */
	fileChange?: "deleted" | "rewritten" | "added";
	/** Not captured, unchanged by this run, but different from HEAD (an earlier run's change). */
	differsFromHead?: boolean;
	/** The image's path relative to the repo root. */
	rel?: string;
}

/** One entry's outcome, as captureAll reports it. */
interface RunResult {
	name: string;
	success: boolean;
	error?: string;
	skipped?: string;
}

/** An entry's image, relative to the repo root (same naming as output.ts). */
export function imageRelPath(entry: ManifestEntry): string {
	return path.posix.join("docs", "public", "images", `${entry.name}.${entry.animation ? "gif" : "webp"}`);
}

/**
 * Pair each run result with the entry's committed image and, for a captured
 * entry, the file the run wrote. Readers take a repo-relative path and return
 * the bytes, or null when there is no such file.
 */
export function collectReviewItems(
	entries: readonly ManifestEntry[],
	results: readonly RunResult[],
	io: {
		readCommitted: (rel: string) => Buffer | null;
		readCurrent: (rel: string) => Buffer | null;
		/** The file as it was on disk before the run started. */
		readBeforeRun: (rel: string) => Buffer | null;
	},
): ReviewItem[] {
	const same = (a: Buffer | null, b: Buffer | null) => (a === null ? b === null : b !== null && a.equals(b));
	return results.map((r) => {
		const entry = entries.find((e) => e.name === r.name);
		const rel = entry ? imageRelPath(entry) : path.posix.join("docs", "public", "images", `${r.name}.webp`);
		const mime = rel.endsWith(".gif") ? "image/gif" : "image/webp";
		const img = (data: Buffer | null): ReviewImage | null => (data ? { mime, data } : null);
		const status = r.skipped ? "skipped" : r.success ? "captured" : "failed";
		const head = io.readCommitted(rel);
		const beforeRun = io.readBeforeRun(rel);
		const current = io.readCurrent(rel);
		const item: ReviewItem = { name: r.name, status, detail: r.skipped ?? r.error, before: img(head), after: null, rel };
		if (status === "captured") {
			item.after = img(current);
		} else if (!same(beforeRun, current)) {
			// This run changed the file without capturing the entry: the
			// content guard deletes a degraded capture (which had already
			// overwritten the committed image), and a step after the capture
			// can fail the entry.
			if (!current) item.fileChange = "deleted";
			else item.fileChange = head ? "rewritten" : "added";
			item.after = img(current);
		} else if (!same(head, current)) {
			// An earlier run's change: shown, never undone for you.
			item.differsFromHead = true;
			item.after = img(current);
		}
		return item;
	});
}

/**
 * Files this run changed without capturing them, to undo before staging:
 * `git restore` the committed ones, remove the new ones.
 */
export function restoreHints(items: readonly ReviewItem[]): { restore: string[]; remove: string[] } {
	const rels = (f: (i: ReviewItem) => boolean) => items.filter((i) => i.rel && f(i)).map((i) => i.rel as string);
	return {
		restore: rels((i) => (i.fileChange === "deleted" && i.before !== null) || i.fileChange === "rewritten"),
		remove: rels((i) => i.fileChange === "added"),
	};
}

type Label = "unchanged" | "changed" | "new" | "failed" | "skipped";

function label(item: ReviewItem): Label {
	if (item.status !== "captured") return item.status;
	if (!item.before) return "new";
	return item.after && item.before.data.equals(item.after.data) ? "unchanged" : "changed";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function figure(caption: string, img: ReviewImage | null): string {
	const body = img
		? `<img alt="${esc(caption)}" src="data:${img.mime};base64,${img.data.toString("base64")}">`
		: `<div class="none">none</div>`;
	return `<figure><figcaption>${esc(caption)}</figcaption>${body}</figure>`;
}

/** The review page HTML: a list of entries to review, then every entry's pair. */
export function buildReviewPage(items: readonly ReviewItem[], opts: { title: string; generated: string }): string {
	const toReview = items.filter((i) => i.fileChange || i.differsFromHead || !["unchanged", "skipped"].includes(label(i)));
	const counts = (["changed", "new", "failed", "unchanged", "skipped"] as Label[])
		.map((l) => `${items.filter((i) => label(i) === l).length} ${l}`)
		.join(" · ");
	const list = toReview.length
		? `<ol>${toReview.map((i) => `<li><a href="#${esc(i.name)}">${esc(i.name)}</a> <span class="badge ${label(i)}">${label(i)}</span></li>`).join("")}</ol>`
		: `<p>Nothing to review: every captured image matches the committed one.</p>`;
	const sections = items
		.map((i) => {
			const l = label(i);
			const detail = i.detail ? `<p class="detail">${esc(i.detail)}</p>` : "";
			const rel = esc(i.rel ?? "");
			const change =
				i.fileChange === "deleted"
					? i.before
						? `<p class="detail">This run deleted the committed image without capturing it. Before staging: <code>git restore ${rel}</code></p>`
						: `<p class="detail">This run deleted an image an earlier run wrote. It was never committed, so there is nothing to restore; capture the entry again.</p>`
					: i.fileChange === "rewritten"
						? `<p class="detail">This run changed the committed image without capturing it. Before staging: <code>git restore ${rel}</code></p>`
						: i.fileChange === "added"
							? `<p class="detail">This run wrote a new image without capturing it. Before staging: <code>rm ${rel}</code></p>`
							: i.differsFromHead
								? i.after
									? `<p class="detail">The image on disk differs from the committed one since before this run (an earlier run's change).</p>`
									: `<p class="detail">The committed image is missing on disk since before this run (an earlier run's change).</p>`
								: "";
			return `<section id="${esc(i.name)}"><h2>${esc(i.name)} <span class="badge ${l}">${l}</span></h2>${detail}${change}<div class="pair">${figure("Committed (HEAD)", i.before)}${figure(i.status === "captured" ? "This run" : "On disk now", i.after)}</div></section>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 24px; color: #1f2328; background: #f6f8fa; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 8px; }
section { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
figure { margin: 0; }
figcaption { font-size: 12px; color: #59636e; margin-bottom: 4px; }
img { max-width: 100%; display: block; background: repeating-conic-gradient(#e6e6e6 0% 25%, #fff 0% 50%) 0 0 / 16px 16px; }
.none { color: #59636e; font-style: italic; padding: 24px 0; }
.detail { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; color: #8a4600; }
.badge { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #eaeef2; }
.badge.changed, .badge.new { background: #ddf4ff; color: #0550ae; }
.badge.failed { background: #fff1c2; color: #7d4e00; }
</style></head>
<body>
<h1>${esc(opts.title)}</h1>
<p>${esc(opts.generated)} · ${counts}</p>
${list}
${sections}
</body></html>
`;
}

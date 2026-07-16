/**
 * D11 — segment an assistant message into markdown | a2ui-surface segments
 * UPSTREAM of MarkdownRenderer.
 *
 * MarkdownRenderer empties and re-renders its whole container on every text
 * change (per streamed chunk), so surfaces can never mount inside it. The
 * message list renders each markdown segment through MarkdownRenderer and
 * each surface segment as a sibling React component with stable identity —
 * mirroring how tool-call blocks already interleave with text.
 *
 * Segmentation is presentation-only: the original fence text stays canonical
 * transcript data (segments concatenate back to the exact input), so restore
 * and replay re-parse stored messages with no separate surface persistence.
 *
 * Streaming: an unclosed a2ui fence stays inside a markdown segment —
 * Obsidian renders open fences as inert code blocks — and upgrades to a
 * surface segment only once the fence closes. Validation happens downstream
 * (surface host), once per closed fence, not here.
 */
import { extractA2uiFences } from "./fence-extractor";

export type AssistantMessageSegment =
	| { kind: "markdown"; text: string }
	| {
			kind: "a2ui-surface";
			/** Fence body (the candidate envelope line) for the validator. */
			body: string;
			/** The verbatim fence block, so segments reassemble to the original text. */
			fenceText: string;
			/** Stable per-message surface ordinal (0-based, in transcript order). */
			index: number;
	  };

export function segmentAssistantMessage(
	text: string,
): AssistantMessageSegment[] {
	if (text.length === 0) return [];

	const closedFences = extractA2uiFences(text).filter((f) => f.closed);
	if (closedFences.length === 0) {
		return [{ kind: "markdown", text }];
	}

	const segments: AssistantMessageSegment[] = [];
	let cursor = 0;
	closedFences.forEach((fence, index) => {
		if (fence.start > cursor) {
			segments.push({
				kind: "markdown",
				text: text.slice(cursor, fence.start),
			});
		}
		segments.push({
			kind: "a2ui-surface",
			body: fence.body,
			fenceText: text.slice(fence.start, fence.end),
			index,
		});
		cursor = fence.end;
	});
	if (cursor < text.length) {
		segments.push({ kind: "markdown", text: text.slice(cursor) });
	}
	return segments;
}

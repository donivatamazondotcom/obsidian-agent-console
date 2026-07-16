/**
 * D11 — assistant messages are segmented upstream of MarkdownRenderer into
 * markdown | a2ui-surface segments. Surface segments mount as sibling
 * components; only markdown segments re-render per streamed chunk.
 *
 * Unclosed (still-streaming) a2ui fences stay inside markdown segments so
 * Obsidian's native open-fence rendering keeps them inert code blocks; a
 * fence upgrades to a surface segment only once it closes (spec § Fence
 * robustness, § Streaming and activation).
 */
import { describe, expect, it } from "vitest";
import { segmentAssistantMessage } from "../segmenter";

const ENVELOPE = '{"version":"v1.0","createSurface":{"surfaceId":"x-1a2b"}}';
const FENCE = "```a2ui\n" + ENVELOPE + "\n```";

describe("segmentAssistantMessage", () => {
	it("returns one markdown segment for fence-free text", () => {
		const segments = segmentAssistantMessage("plain **prose** only");
		expect(segments).toEqual([
			{ kind: "markdown", text: "plain **prose** only" },
		]);
	});

	it("splits around a closed a2ui fence", () => {
		const text = `Pick one:\n\n${FENCE}\n\nOr type it.`;
		const segments = segmentAssistantMessage(text);
		expect(segments.map((s) => s.kind)).toEqual([
			"markdown",
			"a2ui-surface",
			"markdown",
		]);
		const surface = segments[1];
		if (surface.kind === "a2ui-surface") {
			expect(surface.body).toBe(ENVELOPE);
		}
	});

	it("emits no empty markdown segments for a fence at the edges", () => {
		const segments = segmentAssistantMessage(FENCE);
		expect(segments).toHaveLength(1);
		expect(segments[0].kind).toBe("a2ui-surface");
	});

	it("keeps an unclosed trailing fence inside markdown (streaming partial)", () => {
		const text = "Choose:\n```a2ui\n" + ENVELOPE;
		const segments = segmentAssistantMessage(text);
		expect(segments).toEqual([{ kind: "markdown", text }]);
	});

	it("upgrades the fence to a surface segment once it closes", () => {
		const streaming = "Choose:\n```a2ui\n" + ENVELOPE;
		expect(
			segmentAssistantMessage(streaming).every((s) => s.kind === "markdown"),
		).toBe(true);
		const closed = streaming + "\n```\nDone.";
		expect(
			segmentAssistantMessage(closed).map((s) => s.kind),
		).toEqual(["markdown", "a2ui-surface", "markdown"]);
	});

	it("keeps quoted fences inside outer fences as markdown (T08 seed)", () => {
		const text = "````markdown\n" + FENCE + "\n````\nprose";
		const segments = segmentAssistantMessage(text);
		expect(segments).toEqual([{ kind: "markdown", text }]);
	});

	it("produces multiple surface segments in order", () => {
		const text = `${FENCE}\nmiddle\n${FENCE}`;
		const segments = segmentAssistantMessage(text);
		expect(segments.map((s) => s.kind)).toEqual([
			"a2ui-surface",
			"markdown",
			"a2ui-surface",
		]);
	});

	it("preserves the fence block verbatim on surface segments (canonical transcript data)", () => {
		const text = `intro\n${FENCE}\noutro`;
		const segments = segmentAssistantMessage(text);
		const surface = segments.find((s) => s.kind === "a2ui-surface");
		expect(surface?.kind).toBe("a2ui-surface");
		if (surface?.kind === "a2ui-surface") {
			expect(surface.fenceText.startsWith("```a2ui")).toBe(true);
			expect(surface.fenceText).toContain(ENVELOPE);
		}
	});

	it("segments concatenate back to the original text", () => {
		const cases = [
			`a\n${FENCE}\nb`,
			`${FENCE}`,
			`${FENCE}\n${FENCE}`,
			`x\n\n${FENCE}\n\ny\n${FENCE}\nz`,
			"open only\n```a2ui\n" + ENVELOPE,
			"plain text, no fences",
		];
		for (const text of cases) {
			const segments = segmentAssistantMessage(text);
			const rebuilt = segments
				.map((s) => (s.kind === "markdown" ? s.text : s.fenceText))
				.join("");
			expect(rebuilt).toBe(text);
		}
	});

	it("assigns stable per-message surface indexes", () => {
		const text = `${FENCE}\nmid\n${FENCE}`;
		const segments = segmentAssistantMessage(text);
		const surfaces = segments.filter((s) => s.kind === "a2ui-surface");
		expect(surfaces.map((s) => s.kind === "a2ui-surface" && s.index)).toEqual([
			0, 1,
		]);
	});

	it("is total on empty input", () => {
		expect(segmentAssistantMessage("")).toEqual([]);
	});
});

/**
 * Duplicate-surfaceId rule (spec § Fence robustness): within a session the
 * FIRST valid definition wins; later envelopes reusing the id render inert.
 * The registry derives from the transcript in order — same
 * no-separate-store principle as answered state (T05).
 */
import { describe, expect, it } from "vitest";
import { deriveSurfaceDefinitions } from "../surface-state";

const FENCE = (surfaceId: string): string =>
	`\`\`\`a2ui\n{"version":"v1.0","createSurface":{"surfaceId":"${surfaceId}","catalogId":"https://agentconsole.dev/a2ui/catalogs/buttons-v0","components":[{"id":"root","component":"Row","children":["l","b"]},{"id":"l","component":"Text","text":"Go"},{"id":"b","component":"Button","child":"l","action":{"event":{"name":"go","context":{}}}}]}}\n\`\`\``;

describe("deriveSurfaceDefinitions", () => {
	it("registers each valid surface at its first definition site", () => {
		const definitions = deriveSurfaceDefinitions([
			{ role: "assistant", text: `a\n${FENCE("s-one-1a2b")}\nb` },
			{ role: "assistant", text: FENCE("s-two-3c4d") },
		]);
		expect(definitions.get("s-one-1a2b")).toEqual({
			messageIndex: 0,
			surfaceIndex: 0,
		});
		expect(definitions.get("s-two-3c4d")).toEqual({
			messageIndex: 1,
			surfaceIndex: 0,
		});
	});

	it("first valid definition wins across messages", () => {
		const definitions = deriveSurfaceDefinitions([
			{ role: "assistant", text: FENCE("dup-1a2b") },
			{ role: "assistant", text: FENCE("dup-1a2b") },
		]);
		expect(definitions.get("dup-1a2b")).toEqual({
			messageIndex: 0,
			surfaceIndex: 0,
		});
		expect(definitions.size).toBe(1);
	});

	it("indexes multiple surfaces within one message", () => {
		const definitions = deriveSurfaceDefinitions([
			{
				role: "assistant",
				text: `${FENCE("s-a-1a2b")}\nmid\n${FENCE("s-b-3c4d")}`,
			},
		]);
		expect(definitions.get("s-a-1a2b")?.surfaceIndex).toBe(0);
		expect(definitions.get("s-b-3c4d")?.surfaceIndex).toBe(1);
	});

	it("ignores fences in user messages (T08 scope)", () => {
		const definitions = deriveSurfaceDefinitions([
			{ role: "user", text: FENCE("s-user-1a2b") },
		]);
		expect(definitions.size).toBe(0);
	});

	it("skips invalid fences without registering their surfaceId", () => {
		const definitions = deriveSurfaceDefinitions([
			{
				role: "assistant",
				text: '```a2ui\n{"version":"v1.0","createSurface":{"surfaceId":"bad-1a2b","catalogId":"nope","components":[]}}\n```',
			},
			{ role: "assistant", text: FENCE("bad-1a2b") },
		]);
		// The invalid first fence does NOT claim the id; the later valid one does.
		expect(definitions.get("bad-1a2b")).toEqual({
			messageIndex: 1,
			surfaceIndex: 0,
		});
	});
});

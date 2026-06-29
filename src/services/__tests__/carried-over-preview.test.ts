import { describe, it, expect } from "vitest";

import { buildCarriedOverPreview } from "../carried-over-preview";
import type { ChatMessage } from "../../types/chat";

function msg(role: "user" | "assistant", text: string): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content: [{ type: "text", text }],
		timestamp: new Date(),
	};
}

describe("buildCarriedOverPreview", () => {
	it("returns null when there are no messages", () => {
		expect(buildCarriedOverPreview([], "Claude")).toBeNull();
	});

	it("returns null when every turn is empty / non-text", () => {
		const empty = {
			id: "x",
			role: "user",
			content: [],
			timestamp: new Date(),
		} as ChatMessage;
		expect(buildCarriedOverPreview([empty], "Claude")).toBeNull();
	});

	it("carries fromAgent and flattens text turns in order", () => {
		const r = buildCarriedOverPreview(
			[msg("user", "First question"), msg("assistant", "First answer")],
			"Claude",
		);
		expect(r).not.toBeNull();
		expect(r!.fromAgent).toBe("Claude");
		expect(r!.turns).toEqual([
			{ role: "user", text: "First question" },
			{ role: "assistant", text: "First answer" },
		]);
	});

	it("drops empty turns but keeps the non-empty ones", () => {
		const empty = {
			id: "e",
			role: "assistant",
			content: [],
			timestamp: new Date(),
		} as ChatMessage;
		const r = buildCarriedOverPreview([msg("user", "Q1"), empty], "Kiro CLI");
		expect(r!.turns).toEqual([{ role: "user", text: "Q1" }]);
		expect(r!.fromAgent).toBe("Kiro CLI");
	});
});

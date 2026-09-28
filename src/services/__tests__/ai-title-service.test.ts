/**
 * F15 — Rename Tab With AI: pure excerpt builder + side-session reply parser.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../types/chat";
import {
	buildTitleExcerpt,
	buildSideTitlePrompt,
	parseSideTitleReply,
	MAX_AI_TITLE_CHARS,
	requestAiTitle,
} from "../ai-title-service";

let n = 0;
const msg = (
	role: "user" | "assistant",
	text: string,
	extra: ChatMessage["content"] = [],
): ChatMessage => ({
	id: `m${n++}`,
	role,
	content: [{ type: "text", text }, ...extra],
	timestamp: new Date(0),
});

describe("buildTitleExcerpt", () => {
	it("returns null when there is no user/agent text", () => {
		expect(buildTitleExcerpt([])).toBeNull();
		expect(buildTitleExcerpt([msg("user", "   ")])).toBeNull();
	});

	it("labels turns and strips injected context from the first user message", () => {
		const excerpt = buildTitleExcerpt([
			msg(
				"user",
				'<obsidian_context_note ref="x">big note</obsidian_context_note>\nFix the scroll jitter',
			),
			msg("assistant", "<title>Fix scroll jitter</title>\n\nOn it."),
		]);
		expect(excerpt).toContain("User: Fix the scroll jitter");
		expect(excerpt).toContain("Agent: On it.");
		expect(excerpt).not.toContain("obsidian_context_note");
		expect(excerpt).not.toContain("<title>");
	});

	it("skips thoughts, tool calls, and pending messages", () => {
		const excerpt = buildTitleExcerpt([
			msg("user", "Plan the Tokyo trip"),
			{
				id: "t",
				role: "assistant",
				content: [
					{ type: "agent_thought", text: "SECRET-THOUGHT" },
					{
						type: "tool_call",
						toolCallId: "tc",
						title: "SECRET-TOOL",
						status: "completed",
					},
					{ type: "text", text: "Here is a plan." },
				],
				timestamp: new Date(0),
			},
			{ ...msg("user", "QUEUED-NOT-SENT"), pending: true },
		]);
		expect(excerpt).toContain("Here is a plan.");
		expect(excerpt).not.toContain("SECRET-THOUGHT");
		expect(excerpt).not.toContain("SECRET-TOOL");
		expect(excerpt).not.toContain("QUEUED-NOT-SENT");
	});

	it("keeps the first user message plus the latest turns, without duplicating", () => {
		const msgs = [msg("user", "FIRST topic")];
		for (let i = 0; i < 20; i++) {
			msgs.push(msg("assistant", `reply ${i}`), msg("user", `follow-up ${i}`));
		}
		const excerpt = buildTitleExcerpt(msgs) ?? "";
		expect(excerpt.startsWith("User: FIRST topic")).toBe(true);
		expect(excerpt).toContain("follow-up 19");
		expect(excerpt).not.toContain("follow-up 0\n");
		expect(excerpt.match(/FIRST topic/g)).toHaveLength(1);
	});

	it("caps total length", () => {
		const excerpt =
			buildTitleExcerpt(
				[msg("user", "a".repeat(20000)), msg("assistant", "b".repeat(20000))],
				{ maxChars: 1000 },
			) ?? "";
		expect(excerpt.length).toBeLessThanOrEqual(1000);
		expect(excerpt).toContain("Agent: b");
	});
});

describe("buildSideTitlePrompt", () => {
	it("wraps the excerpt and asks for the marker only", () => {
		const prompt = buildSideTitlePrompt("User: hi");
		expect(prompt).toContain("User: hi");
		expect(prompt).toMatch(/<title>/);
		expect(prompt).toMatch(/only/i);
	});
});

describe("parseSideTitleReply", () => {
	it("extracts a leading marker", () => {
		expect(parseSideTitleReply("<title>Fix scroll jitter</title>")).toBe(
			"Fix scroll jitter",
		);
	});

	it("extracts a marker after a preamble", () => {
		expect(
			parseSideTitleReply("Sure! Here you go:\n<title>Plan Tokyo trip</title>"),
		).toBe("Plan Tokyo trip");
	});

	it("falls back to the first non-empty line, cleaned", () => {
		expect(parseSideTitleReply('\n  "Compare ACP agents."  \nmore')).toBe(
			"Compare ACP agents",
		);
	});

	it("returns null for an empty reply", () => {
		expect(parseSideTitleReply("   \n ")).toBeNull();
		expect(parseSideTitleReply("<title>  </title>")).toBeNull();
	});

	it("caps length", () => {
		const t = parseSideTitleReply(`<title>${"x".repeat(200)}</title>`) ?? "";
		expect(t.length).toBeLessThanOrEqual(MAX_AI_TITLE_CHARS);
	});
});

describe("requestAiTitle (orchestration over the side-title port)", () => {
	it("returns no-content without calling the agent when there is nothing to title", async () => {
		const port = { requestSideTitle: vi.fn() };
		const res = await requestAiTitle({ messages: [], port, cwd: "/v" });
		expect(res).toEqual({ kind: "no-content" });
		expect(port.requestSideTitle).not.toHaveBeenCalled();
	});

	it("sends the built prompt and parses the reply", async () => {
		const port = {
			requestSideTitle: vi.fn(async () => ({
				sessionId: "SIDE",
				text: "<title>Plan Tokyo trip</title>",
			})),
		};
		const res = await requestAiTitle({
			messages: [msg("user", "help me plan a week in Tokyo")],
			port,
			cwd: "/v",
		});
		expect(res).toEqual({
			kind: "title",
			title: "Plan Tokyo trip",
			sideSessionId: "SIDE",
		});
		const [prompt, cwd] = port.requestSideTitle.mock.calls[0] as unknown as [
			string,
			string,
		];
		expect(prompt).toContain("User: help me plan a week in Tokyo");
		expect(cwd).toBe("/v");
	});

	it("maps an empty reply to no-title and a thrown error to failed", async () => {
		const empty = {
			requestSideTitle: vi.fn(async () => ({ sessionId: "S", text: " " })),
		};
		expect(
			await requestAiTitle({ messages: [msg("user", "x")], port: empty, cwd: "" }),
		).toEqual({ kind: "no-title", sideSessionId: "S" });

		const boom = {
			requestSideTitle: vi.fn(async () => {
				throw new Error("timed out");
			}),
		};
		const res = await requestAiTitle({
			messages: [msg("user", "x")],
			port: boom,
			cwd: "",
		});
		expect(res.kind).toBe("failed");
	});
});

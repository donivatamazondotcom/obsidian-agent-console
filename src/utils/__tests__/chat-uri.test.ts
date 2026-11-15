/**
 * Chat ID — the chat link and its rate limit ([[Agent Console Chat ID]]).
 *
 * T12: a link survives a round trip when the vault name and the chat ID need
 * encoding, and a title with brackets stays one Markdown link. The round trip
 * goes through `URL`, the same decoding Obsidian applies before it hands the
 * params to a protocol handler.
 *
 * T26 / T35 (limiter half): only the 2 s limit applies. A repeat of the same
 * chat within 2 s is dropped silently, a different chat within 2 s gets the
 * rate notice, and a rejected link never moves the window.
 *
 * Literals only (R5).
 */
import { describe, expect, it } from "vitest";
import {
	CHAT_LINK_ACTION,
	buildChatLinkMarkdown,
	buildChatUri,
	checkChatLinkRateLimit,
	escapeLinkTitle,
	parseChatLinkParams,
} from "../chat-uri";

function paramsOf(uri: string): Record<string, string> {
	const url = new URL(uri);
	const out: Record<string, string> = { action: url.host };
	url.searchParams.forEach((v, k) => {
		out[k] = v;
	});
	return out;
}

describe("T12 chat link round trip", () => {
	const vault = "Work (2026) vault ä";
	const id = "sess a&b=c/d%e(f)";

	it("encodes the vault and the chat ID, including parentheses", () => {
		expect(buildChatUri(vault, id)).toBe(
			"obsidian://agent-console-chat?vault=Work%20%282026%29%20vault%20%C3%A4&id=sess%20a%26b%3Dc%2Fd%25e%28f%29",
		);
	});

	it("parses back to the same vault and chat ID", () => {
		const params = paramsOf(buildChatUri(vault, id));
		expect(params.action).toBe(CHAT_LINK_ACTION);
		expect(params.vault).toBe(vault);
		expect(parseChatLinkParams(params)).toEqual({ kind: "ok", id });
	});

	it("escapes brackets and backslashes in the title", () => {
		expect(escapeLinkTitle("Plan [draft] \\ v2")).toBe(
			"Plan \\[draft\\] \\\\ v2",
		);
	});

	it("builds one Markdown link whose target has no raw space or parenthesis", () => {
		expect(buildChatLinkMarkdown("Plan [draft]", vault, id)).toBe(
			"[Plan \\[draft\\]](obsidian://agent-console-chat?vault=Work%20%282026%29%20vault%20%C3%A4&id=sess%20a%26b%3Dc%2Fd%25e%28f%29)",
		);
	});
});

describe("parseChatLinkParams", () => {
	it.each([
		[{}],
		[{ id: "" }],
		[{ id: "   " }],
		[{ id: undefined }],
	])("%j has no usable id", (params) => {
		expect(parseChatLinkParams(params)).toEqual({
			kind: "bad-param",
			field: "id",
		});
	});

	it("returns a non-blank id unchanged", () => {
		expect(parseChatLinkParams({ id: "rec-1" })).toEqual({
			kind: "ok",
			id: "rec-1",
		});
	});
});

describe("T26 / T35 checkChatLinkRateLimit", () => {
	it("accepts the first link", () => {
		expect(checkChatLinkRateLimit({}, "rec-1", 1_000)).toEqual({
			ok: true,
			state: { lastAt: 1_000, lastId: "rec-1" },
		});
	});

	it("T26: the same chat 3 s later is accepted (no 10 s duplicate rule)", () => {
		expect(
			checkChatLinkRateLimit({ lastAt: 1_000, lastId: "rec-1" }, "rec-1", 4_000),
		).toEqual({ ok: true, state: { lastAt: 4_000, lastId: "rec-1" } });
	});

	it("T35: the same chat within 2 s is a silent repeat", () => {
		expect(
			checkChatLinkRateLimit({ lastAt: 1_000, lastId: "rec-1" }, "rec-1", 2_500),
		).toEqual({ ok: false, reason: "repeat" });
	});

	it("T35: a different chat within 2 s is rate-limited", () => {
		expect(
			checkChatLinkRateLimit({ lastAt: 1_000, lastId: "rec-1" }, "rec-2", 2_500),
		).toEqual({ ok: false, reason: "rate-limit" });
	});

	it("T35: a rejected link doesn't move the window, so 2.5 s after the first is accepted", () => {
		const first = { lastAt: 1_000, lastId: "rec-1" };
		expect(checkChatLinkRateLimit(first, "rec-2", 2_000).ok).toBe(false);
		// The caller keeps `first`; the rejection returned no state.
		expect(checkChatLinkRateLimit(first, "rec-2", 3_500)).toEqual({
			ok: true,
			state: { lastAt: 3_500, lastId: "rec-2" },
		});
	});

	it("a link with no id is keyed by an empty string", () => {
		expect(
			checkChatLinkRateLimit({ lastAt: 1_000, lastId: "" }, "", 1_500),
		).toEqual({ ok: false, reason: "repeat" });
	});
});

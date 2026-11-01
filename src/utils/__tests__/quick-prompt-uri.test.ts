/**
 * Pure URI layer for `obsidian://agent-console?...` quick-prompt links.
 * Spec: [[Agent Console Quick Prompt URIs]] T01–T03, T08, T09, T17 (link shape).
 *
 * Red-first: written before `src/utils/quick-prompt-uri.ts` exists.
 */
import { describe, it, expect } from "vitest";
import {
	parseQuickPromptUri,
	sanitizeExternalText,
	checkUriRateLimit,
	formatExternalBlock,
	buildPromptUri,
	uriFireKey,
	URI_RATE_LIMIT_MS,
	URI_DUPLICATE_WINDOW_MS,
	type UriRateLimitState,
} from "../quick-prompt-uri";

const PROMPTS = [
	{ id: "test-debrief", label: "Debrief" },
	{ id: "test-daily", label: "Daily review" },
];

describe("parseQuickPromptUri", () => {
	it("T01: a valid URI resolves the prompt and carries only the given context", () => {
		const r = parseQuickPromptUri(
			{
				action: "agent-console",
				vault: "v",
				prompt: "test-debrief",
				selection: "x",
				url: "https://e.com",
			},
			PROMPTS,
		);
		expect(r).toEqual({
			kind: "ok",
			prompt: PROMPTS[0],
			context: { selection: "x", url: "https://e.com" },
		});
	});

	it("T01: agent, mode and title are carried through", () => {
		const r = parseQuickPromptUri(
			{ prompt: "test-daily", agent: "test-kiro", mode: "plan", title: "T" },
			PROMPTS,
		);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") {
			expect(r.context).toEqual({ agent: "test-kiro", mode: "plan", title: "T" });
		}
	});

	it("T02: an unknown prompt id is unknown-prompt, never a guess", () => {
		expect(parseQuickPromptUri({ prompt: "test-nope" }, PROMPTS)).toEqual({
			kind: "unknown-prompt",
			promptId: "test-nope",
		});
	});

	it("T02: ids are matched exactly, not by label or case", () => {
		expect(parseQuickPromptUri({ prompt: "Debrief" }, PROMPTS).kind).toBe(
			"unknown-prompt",
		);
		expect(parseQuickPromptUri({ prompt: "TEST-DEBRIEF" }, PROMPTS).kind).toBe(
			"unknown-prompt",
		);
	});

	it("T03: a missing prompt is bad-param naming the field", () => {
		expect(parseQuickPromptUri({ selection: "x" }, PROMPTS)).toEqual({
			kind: "bad-param",
			field: "prompt",
		});
	});

	it("T03: an empty optional param is bad-param, not coerced to a default", () => {
		for (const field of ["selection", "url", "title", "agent", "mode"]) {
			expect(
				parseQuickPromptUri({ prompt: "test-debrief", [field]: "" }, PROMPTS),
			).toEqual({ kind: "bad-param", field });
		}
		expect(
			parseQuickPromptUri({ prompt: "test-debrief", agent: "   " }, PROMPTS),
		).toEqual({ kind: "bad-param", field: "agent" });
	});

	it("ignores params the contract doesn't define (no send, no open, no body)", () => {
		const r = parseQuickPromptUri(
			{ prompt: "test-debrief", send: "true", open: "here", body: "rm -rf" },
			PROMPTS,
		);
		expect(r).toEqual({ kind: "ok", prompt: PROMPTS[0], context: {} });
	});
});

describe("sanitizeExternalText (T08)", () => {
	it("strips zero-width and bidi-override characters and counts them", () => {
		expect(sanitizeExternalText("a\u200Bb\u202Ec")).toEqual({
			text: "abc",
			removed: 2,
		});
	});

	it("covers the full invisible set (ZW, LRM/RLM, embeddings, isolates, BOM, word joiner)", () => {
		const hidden =
			"\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2066\u2067\u2068\u2069\uFEFF";
		expect(sanitizeExternalText(`x${hidden}y`)).toEqual({
			text: "xy",
			removed: [...hidden].length,
		});
	});

	it("leaves ordinary text, newlines and non-Latin scripts untouched", () => {
		const s = "Hello\nनमस्ते — 你好 🙂";
		expect(sanitizeExternalText(s)).toEqual({ text: s, removed: 0 });
	});
});

describe("checkUriRateLimit (T09)", () => {
	const empty: UriRateLimitState = {};

	it("allows the first fire and records it", () => {
		const r = checkUriRateLimit(empty, "k1", 1_000);
		expect(r).toEqual({ ok: true, state: { lastAt: 1_000, lastKey: "k1" } });
	});

	it("rejects a different fire within 2 s as rate-limited", () => {
		const first = checkUriRateLimit(empty, "k1", 1_000);
		if (!first.ok) throw new Error("first fire must pass");
		expect(checkUriRateLimit(first.state, "k2", 1_500)).toEqual({
			ok: false,
			reason: "rate-limit",
		});
	});

	it("rejects an exact repeat within 10 s as a duplicate, even after 2 s", () => {
		const first = checkUriRateLimit(empty, "k1", 1_000);
		if (!first.ok) throw new Error("first fire must pass");
		expect(checkUriRateLimit(first.state, "k1", 6_000)).toEqual({
			ok: false,
			reason: "duplicate",
		});
	});

	it("allows a different fire after 2 s and a repeat after 10 s", () => {
		const first = checkUriRateLimit(empty, "k1", 1_000);
		if (!first.ok) throw new Error("first fire must pass");
		expect(
			checkUriRateLimit(first.state, "k2", 1_000 + URI_RATE_LIMIT_MS).ok,
		).toBe(true);
		expect(
			checkUriRateLimit(first.state, "k1", 1_000 + URI_DUPLICATE_WINDOW_MS).ok,
		).toBe(true);
	});

	it("a rejected fire does not move the window (a redirect loop can't keep itself alive)", () => {
		const first = checkUriRateLimit(empty, "k1", 1_000);
		if (!first.ok) throw new Error("first fire must pass");
		const rejected = checkUriRateLimit(first.state, "k2", 1_500);
		expect(rejected.ok).toBe(false);
		// State is unchanged, so 2 s after the FIRST fire a new one passes.
		expect(checkUriRateLimit(first.state, "k2", 3_000).ok).toBe(true);
	});

	it("uriFireKey is order-independent and distinguishes any param change", () => {
		expect(uriFireKey({ prompt: "a", url: "u" })).toBe(
			uriFireKey({ url: "u", prompt: "a" }),
		);
		expect(uriFireKey({ prompt: "a", url: "u" })).not.toBe(
			uriFireKey({ prompt: "a", url: "u2" }),
		);
	});
});

describe("formatExternalBlock (T07 heading shape)", () => {
	it("puts the heading first and quotes every line, including blank ones", () => {
		expect(formatExternalBlock("line one\n\nline three", "HEAD")).toBe(
			"HEAD\n> line one\n>\n> line three",
		);
	});

	it("keeps quote markers inside the text quoted (no escape from the block)", () => {
		expect(formatExternalBlock("> fake\n```", "H")).toBe("H\n> > fake\n> ```");
	});
});

describe("buildPromptUri (T17 link shape)", () => {
	it("builds the base link with vault and prompt, both encoded", () => {
		expect(buildPromptUri("My Vault", "test-debrief")).toBe(
			"obsidian://agent-console?vault=My%20Vault&prompt=test-debrief",
		);
	});

	it("round-trips through parseQuickPromptUri", () => {
		const uri = buildPromptUri("v&x", "test-daily");
		const params = Object.fromEntries(new URL(uri).searchParams);
		expect(params.vault).toBe("v&x");
		expect(parseQuickPromptUri(params, PROMPTS).kind).toBe("ok");
	});
});

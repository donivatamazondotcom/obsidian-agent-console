/**
 * A damaged link fails loud: the `crc` check, the stray-key rule and their
 * order. Spec: [[Agent Console Fresh-Session Handoff]] § Plugin change,
 * T01–T03, T05, T06. CRC values were computed with Python's `zlib.crc32`.
 *
 * Red-first: written before the rules existed in `parseQuickPromptUri`.
 */
import { describe, it, expect } from "vitest";
import { parseQuickPromptUri } from "../quick-prompt-uri";
import {
	buildQuickPrompt,
	planUriFire,
} from "../../services/quick-prompts-logic";

const PROMPTS = [{ id: "continue-handoff" }, { id: "test-daily" }];
const STRICT = { strictKeys: true };
const LOOSE = { strictKeys: false };

/** "Fix A&B then C\nand ship #42 (today)" */
const ORIGINAL = "Fix A&B then C\nand ship #42 (today)";
const ORIGINAL_CRC = "23cf39ff";

describe("T01: an unencoded # cuts the text", () => {
	it("is cut-short with the hash reason", () => {
		expect(
			parseQuickPromptUri(
				{ prompt: "continue-handoff", selection: "See issue ", hash: "42 then ship" },
				PROMPTS,
				STRICT,
			),
		).toEqual({ kind: "cut-short", reason: "hash" });
	});
});

describe("T02: a stray key cuts the text", () => {
	it.each(["selection", "url", "title"])(
		"is cut-short naming the key when %s is the free-text field",
		(field) => {
			expect(
				parseQuickPromptUri(
					{ prompt: "continue-handoff", [field]: "Fix A", "B then C": "" },
					PROMPTS,
					STRICT,
				),
			).toEqual({ kind: "cut-short", reason: "stray-key", key: "B then C" });
		},
	);

	it("reports the raw key; the notice builder cleans it", () => {
		const key = "abc\u202Eevil";
		expect(
			parseQuickPromptUri({ prompt: "continue-handoff", selection: "x", [key]: "" }, PROMPTS, STRICT),
		).toEqual({ kind: "cut-short", reason: "stray-key", key });
	});
});

describe("T03: existing links behave as today", () => {
	it("a stray key with no free text and no crc is ok", () => {
		expect(
			parseQuickPromptUri(
				{ prompt: "test-daily", send: "true", open: "here", body: "rm -rf" },
				PROMPTS,
				STRICT,
			),
		).toEqual({ kind: "ok", prompt: PROMPTS[1], context: {} });
	});

	it("vault, action and prompt alone are ok", () => {
		expect(
			parseQuickPromptUri(
				{ action: "agent-console", vault: "v", prompt: "test-daily" },
				PROMPTS,
				STRICT,
			).kind,
		).toBe("ok");
	});

	it("a free-text link with x-callback keys is ok", () => {
		const r = parseQuickPromptUri(
			{
				action: "agent-console",
				vault: "v",
				prompt: "test-daily",
				selection: "x",
				"x-success": "shortcuts://",
				"x-error": "shortcuts://",
				"x-cancel": "shortcuts://",
				"x-source": "Shortcuts",
			},
			PROMPTS,
			STRICT,
		);
		expect(r).toEqual({ kind: "ok", prompt: PROMPTS[1], context: { selection: "x" } });
	});

	it("every contract key is allowed with free text, including agent and mode", () => {
		const r = parseQuickPromptUri(
			{
				action: "agent-console",
				vault: "v",
				prompt: "test-daily",
				selection: "x",
				url: "https://e.com",
				title: "t",
				agent: "a",
				mode: "m",
			},
			PROMPTS,
			STRICT,
		);
		expect(r.kind).toBe("ok");
	});

	it("strict keys is the default", () => {
		expect(
			parseQuickPromptUri({ prompt: "test-daily", selection: "x", stray: "" }, PROMPTS),
		).toEqual({ kind: "cut-short", reason: "stray-key", key: "stray" });
	});

	it("with strictKeys off, a stray key or # with free text is ok", () => {
		expect(
			parseQuickPromptUri({ prompt: "test-daily", selection: "Fix A", "B then C": "" }, PROMPTS, LOOSE),
		).toEqual({ kind: "ok", prompt: PROMPTS[1], context: { selection: "Fix A" } });
		expect(
			parseQuickPromptUri({ prompt: "test-daily", selection: "See ", hash: "42" }, PROMPTS, LOOSE)
				.kind,
		).toBe("ok");
	});

	it("with strictKeys off, a CRC mismatch is still cut-short", () => {
		expect(
			parseQuickPromptUri(
				{ prompt: "test-daily", selection: "Fix A", crc: ORIGINAL_CRC },
				PROMPTS,
				LOOSE,
			),
		).toEqual({ kind: "cut-short", reason: "crc" });
	});
});

describe("T05: CRC match and mismatch", () => {
	const fire = (selection: string | undefined, crc: string) =>
		parseQuickPromptUri(
			{ prompt: "continue-handoff", crc, ...(selection !== undefined ? { selection } : {}) },
			PROMPTS,
			STRICT,
		);

	it("a matching crc is ok", () => {
		expect(fire(ORIGINAL, ORIGINAL_CRC)).toEqual({
			kind: "ok",
			prompt: PROMPTS[0],
			context: { selection: ORIGINAL },
		});
	});

	it.each([
		["one character dropped", "Fix A&B then C\nand ship #42 (today"],
		["a line break dropped", "Fix A&B then Cand ship #42 (today)"],
		["+ for every space", "Fix+A&B+then+C\nand+ship+#42+(today)"],
		["a different selection", "Something else"],
	])("is cut-short with %s", (_name, selection) => {
		expect(fire(selection, ORIGINAL_CRC)).toEqual({ kind: "cut-short", reason: "crc" });
	});

	it("is cut-short when crc has no selection", () => {
		expect(fire(undefined, ORIGINAL_CRC)).toEqual({ kind: "cut-short", reason: "crc" });
	});

	it.each(["xyz", "", "23cf39f", "23cf39ff0", "23cf39fg"])(
		"is cut-short when crc %j isn't eight hex digits",
		(crc) => {
			expect(fire(ORIGINAL, crc)).toEqual({ kind: "cut-short", reason: "crc" });
		},
	);

	it("accepts an uppercase crc and a leading zero", () => {
		expect(fire(ORIGINAL, ORIGINAL_CRC.toUpperCase()).kind).toBe("ok");
		expect(fire("handoff 53", "040b1197").kind).toBe("ok");
	});

	it("checks the raw text, so hidden characters are stripped after a match", () => {
		const raw = "a\u200Bb \u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
		const parsed = fire(raw, "186fe957");
		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") return;
		const prompt = buildQuickPrompt({
			path: "Quick Prompts/continue-handoff.md",
			basename: "continue-handoff",
			frontmatter: { "uri override": false },
			body: "Continue:\n\n{{selection}}",
		});
		const plan = planUriFire(prompt, parsed.context, {
			agents: [{ id: "test-claude", name: "Test Claude" }],
			defaultAgentId: "test-claude",
		});
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.removedChars).toBe(1);
		expect(plan.text).toContain("> ab \u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
	});
});

describe("T06: the rules run first", () => {
	it("a # beats a blank selection's bad-param", () => {
		expect(
			parseQuickPromptUri({ prompt: "continue-handoff", selection: "", hash: "42" }, PROMPTS, STRICT),
		).toEqual({ kind: "cut-short", reason: "hash" });
	});

	it("a # beats a missing prompt's bad-param", () => {
		expect(parseQuickPromptUri({ selection: "x", hash: "y" }, PROMPTS, STRICT)).toEqual({
			kind: "cut-short",
			reason: "hash",
		});
	});

	it("an unencoded &mode= that forms a contract key is caught by the crc", () => {
		expect(
			parseQuickPromptUri(
				{ prompt: "continue-handoff", selection: "Fix A", mode: "plan then ship", crc: "2861016a" },
				PROMPTS,
				STRICT,
			),
		).toEqual({ kind: "cut-short", reason: "crc" });
	});

	it("a crc on a link to an unknown prompt fails as cut-short, not unknown-prompt", () => {
		expect(
			parseQuickPromptUri({ prompt: "test-nope", selection: "x", crc: ORIGINAL_CRC }, PROMPTS, STRICT),
		).toEqual({ kind: "cut-short", reason: "crc" });
	});
});

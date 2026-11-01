/**
 * URI fire plan + in-app {{url}}/{{title}} + `uri send` / `uri override`
 * frontmatter + "Copy link" chip action.
 * Spec: [[Agent Console Quick Prompt URIs]] T04–T07, T10, T11.
 *
 * Enters at the same seams the runtime uses: `buildQuickPrompt` (real
 * frontmatter shape) → `planUriFire` (what the protocol handler calls).
 * Red-first: written before `planUriFire` exists.
 */
import { describe, it, expect } from "vitest";
import {
	buildQuickPrompt,
	buildChipMenuItems,
	planUriFire,
	resolvePromptText,
	planQuickPromptFire,
} from "../quick-prompts-logic";
import type { ExternalPromptContext } from "../../types/quick-prompt";

const AGENTS = [
	{ id: "test-claude", name: "Test Claude" },
	{ id: "test-kiro", name: "Test Kiro" },
];
const CTX = { agents: AGENTS, defaultAgentId: "test-claude" };

function prompt(fm: Record<string, unknown>, body = "Do the thing.") {
	return buildQuickPrompt({
		path: "Quick Prompts/test-p.md",
		basename: "test-p",
		frontmatter: fm,
		body,
	});
}

describe("frontmatter: uri send / uri override", () => {
	it("parses `uri send: true` and `uri override: false`", () => {
		const p = prompt({ "uri send": true, "uri override": false });
		expect(p.uriSend).toBe(true);
		expect(p.uriOverride).toBe(false);
	});

	it("only a real boolean counts (strings don't enable auto-send)", () => {
		const p = prompt({ "uri send": "true", "uri override": "false" });
		expect(p.uriSend).toBeUndefined();
		expect(p.uriOverride).toBeUndefined();
	});
});

describe("planUriFire", () => {
	it("T04: stages in a new foreground tab by default, never sends", () => {
		const plan = planUriFire(prompt({}), {}, CTX);
		expect(plan).toMatchObject({
			kind: "new-tab",
			send: false,
			agentId: "test-claude",
			linkOrigin: false,
		});
	});

	it("T05: a bare link to a `uri send` prompt sends (through the new tab's queue)", () => {
		const plan = planUriFire(prompt({ "uri send": true }), {}, CTX);
		expect(plan).toMatchObject({ kind: "new-tab", send: true });
	});

	it("T06: any outside value drops a `uri send` prompt back to staging", () => {
		const cases: ExternalPromptContext[] = [
			{ selection: "x" },
			{ url: "https://e.com" },
			{ title: "t" },
			{ agent: "test-kiro" },
			{ mode: "plan" },
		];
		for (const ext of cases) {
			const plan = planUriFire(prompt({ "uri send": true }), ext, CTX);
			expect(plan.kind).toBe("new-tab");
			if (plan.kind === "new-tab") expect(plan.send).toBe(false);
		}
	});

	it("T06: a bare link still stages when the prompt needs a selection it didn't get", () => {
		const plan = planUriFire(
			prompt({ "uri send": true }, "Summarize {{selection}}"),
			{},
			CTX,
		);
		expect(plan).toMatchObject({ kind: "new-tab", send: false, reason: "no-selection" });
	});

	it("T07: fills {{selection}} with a quoted block headed by length + claimed source", () => {
		const plan = planUriFire(
			prompt({}, "Summarize:\n{{selection}}\nFrom {{title}} ({{url}})"),
			{ selection: "hello\nworld", url: "https://mail.example.com/x", title: "Re: Q3" },
			CTX,
		);
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.text).toBe(
			"Summarize:\n" +
				"External text · 11 chars · claimed source: mail.example.com\n" +
				"> hello\n> world\n" +
				"From Re: Q3 (https://mail.example.com/x)",
		);
	});

	it("T07: the char count uses thousands separators", () => {
		const plan = planUriFire(
			prompt({}, "{{selection}}"),
			{ selection: "a".repeat(48212) },
			CTX,
		);
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.text.split("\n")[0]).toBe("External text · 48,212 chars");
	});

	it("T07: claimed source falls back to the title when there is no url", () => {
		const plan = planUriFire(prompt({}, "{{selection}}"), { selection: "x", title: "Vendor page" }, CTX);
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.text.split("\n")[0]).toBe(
			"External text · 1 chars · claimed source: Vendor page",
		);
	});

	it("decision (a): a selection on a prompt without {{selection}} is appended as the quoted block", () => {
		const plan = planUriFire(prompt({}, "Draft a reply."), { selection: "body text" }, CTX);
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.text).toBe(
			"Draft a reply.\n\nExternal text · 9 chars\n> body text",
		);
	});

	it("T08: invisible characters are stripped from all outside text and counted", () => {
		const plan = planUriFire(
			prompt({}, "{{selection}} | {{title}}"),
			{ selection: "a\u200Bb\u202Ec", title: "t\u2066" },
			CTX,
		);
		if (plan.kind !== "new-tab") throw new Error("expected new-tab");
		expect(plan.removedChars).toBe(3);
		expect(plan.text).not.toMatch(/[\u200B\u202E\u2066]/);
		expect(plan.text).toContain("> abc");
	});

	it("T10: URI agent overrides the note's agent", () => {
		const plan = planUriFire(prompt({ agent: "test-kiro" }), { agent: "test-claude" }, CTX);
		expect(plan).toMatchObject({ kind: "new-tab", agentId: "test-claude", linkOrigin: true });
	});

	it("T10: `uri override: false` ignores URI agent and mode, and shows no banner", () => {
		const plan = planUriFire(
			prompt({ agent: "test-kiro", "uri override": false }),
			{ agent: "test-claude", mode: "plan" },
			CTX,
		);
		expect(plan).toMatchObject({ kind: "new-tab", agentId: "test-kiro", linkOrigin: false });
		if (plan.kind === "new-tab") expect(plan.modeId).toBeUndefined();
	});

	it("T10: no agent anywhere → the default agent", () => {
		expect(planUriFire(prompt({}), {}, CTX)).toMatchObject({ agentId: "test-claude" });
	});

	it("T10: agent by display name resolves through the shared lookup", () => {
		expect(planUriFire(prompt({}), { agent: "Test Kiro" }, CTX)).toMatchObject({
			agentId: "test-kiro",
		});
	});

	it("T10: link mode with note agent keeps both, mode travels raw to the new tab", () => {
		const plan = planUriFire(prompt({ agent: "test-kiro" }), { mode: "plan" }, CTX);
		expect(plan).toMatchObject({
			kind: "new-tab",
			agentId: "test-kiro",
			modeId: "plan",
			linkOrigin: true,
		});
	});

	it("a note-set mode alone shows no banner (the link didn't choose it)", () => {
		expect(planUriFire(prompt({ mode: "plan" }), {}, CTX)).toMatchObject({
			modeId: "plan",
			linkOrigin: false,
		});
	});

	it("an unknown URI agent fails loud — nothing opens", () => {
		expect(planUriFire(prompt({}), { agent: "test-nope" }, CTX)).toEqual({
			kind: "unknown-agent",
			requested: "test-nope",
		});
	});
});

describe("T11: in-app {{url}} / {{title}}", () => {
	it("resolvePromptText fills url and title from the supplied note source", () => {
		expect(
			resolvePromptText("{{title}} — {{url}}", null, {
				url: "https://e.com",
				title: "Note A",
			}),
		).toBe("Note A — https://e.com");
	});

	it("absent source → empty strings", () => {
		expect(resolvePromptText("[{{title}}|{{url}}]", null)).toBe("[|]");
	});

	it("planQuickPromptFire threads the active note source into the text", () => {
		const plan = planQuickPromptFire(prompt({}, "See {{url}}"), {
			openElsewhere: false,
			foreground: false,
			insert: false,
			composerHasText: false,
			isStreaming: false,
			isQueued: false,
			selectionText: null,
			noteSource: { url: "https://src.example", title: "N" },
		});
		expect(plan.text).toBe("See https://src.example");
	});
});

describe("chip menu: Copy link", () => {
	it("adds a copy-link action after the existing three", () => {
		const actions = buildChipMenuItems().map((i) => i.action);
		expect(actions).toEqual(["edit", "copy", "copy-link", "rename"]);
	});
});

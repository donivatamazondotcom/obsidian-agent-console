/**
 * picker-source-configs — exhaustive per-source contract tests (Tier 3).
 *
 * Pins every divergent behavior the unified picker must preserve, source by
 * source: trigger detection, item fetch, row projection, nav policy (clamp vs
 * wrap), select-text rewrite, footer instructions, the mention dismiss guard
 * flag, the quick-prompt create row, and the Tier-2 keyboard capabilities.
 * These are the resolver truth tables that land GREEN before `useSuggestions`
 * is rewired (extract-before-rewire).
 *
 * Spec: [[Unified Picker Control]] (Tier 3).
 */
import { describe, it, expect, vi } from "vitest";
import {
	makeMentionSource,
	makeSlashSource,
	makeQuickPromptSource,
	type FuzzyScorer,
} from "../picker-source-configs";
import {
	mentionInstructions,
	slashInstructions,
} from "../picker-sources";
import type { NoteMetadata } from "../../services/vault-service";
import type { SlashCommand } from "../../types/session";
import type { QuickPrompt } from "../../types/quick-prompt";
import type { CreatePromptRow } from "../../services/quick-prompts-logic";

const note = (name: string): NoteMetadata => ({
	path: `${name}.md`,
	name,
	extension: "md",
	created: 0,
	modified: 0,
});

const cmd = (name: string): SlashCommand => ({
	name,
	description: `${name} command`,
});

const qp = (id: string, label: string, over: Partial<QuickPrompt> = {}): QuickPrompt => ({
	id,
	label,
	body: `body ${label}`,
	path: `Quick Prompts/${id}.md`,
	usesSelection: false,
	...over,
});

// Substring scorer mirroring the obsidian stub (shorter labels rank higher).
const substringScorer = (query: string): FuzzyScorer => {
	const q = query.toLowerCase();
	return (text: string) =>
		text.toLowerCase().includes(q) ? { score: -text.length } : null;
};

// ── Mention `@` ───────────────────────────────────────────────────────────

describe("makeMentionSource", () => {
	const search = vi.fn(async (q: string) =>
		[note("Alpha"), note("Beta")].filter((n) =>
			n.name.toLowerCase().includes(q.toLowerCase()),
		),
	);
	const source = makeMentionSource(search);

	it("is the mention kind, clamps, guards dismiss, and declares Shift+Enter dismiss", () => {
		expect(source.kind).toBe("mention");
		expect(source.navPolicy).toBe("clamp");
		expect(source.dismissGuard).toBe(true);
		expect(source.capabilities).toEqual({
			dismissOnShiftEnter: true,
			ownsEnterScopeCombos: false,
		});
	});

	it("detects the @ trigger and carries start/end/query", () => {
		expect(source.detectTrigger("@al", 3)).toEqual({
			start: 0,
			end: 3,
			query: "al",
		});
		expect(source.detectTrigger("no mention", 10)).toBeNull();
	});

	it("fetches via the injected async vault search", async () => {
		const ctx = source.detectTrigger("@al", 3)!;
		await expect(source.fetchItems(ctx)).resolves.toEqual([note("Alpha")]);
		expect(search).toHaveBeenCalledWith("al");
	});

	it("rewrites the @query token into the @[[Note]] form on select", () => {
		const ctx = source.detectTrigger("hi @al", 6)!;
		const out = source.onSelect("hi @al", ctx, note("Alpha"));
		expect(out).toBe("hi  @[[Alpha]] ");
	});

	it("returns the mention footer instructions", () => {
		expect(source.instructions({ isCreateSelected: false })).toEqual(
			mentionInstructions(),
		);
	});

	it("has no create row", () => {
		expect(source.createRow).toBeUndefined();
	});
});

// ── Slash `/` ───────────────────────────────────────────────────────────────

describe("makeSlashSource", () => {
	const commands = [cmd("help"), cmd("clear"), cmd("compact")];
	const source = makeSlashSource(commands);

	it("is the slash kind, clamps, no guard, no special key capabilities", () => {
		expect(source.kind).toBe("slash");
		expect(source.navPolicy).toBe("clamp");
		expect(source.dismissGuard).toBeUndefined();
		expect(source.capabilities).toEqual({
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: false,
		});
	});

	it("detects the / trigger only at input start", () => {
		expect(source.detectTrigger("/cl", 3)).toEqual({
			start: 0,
			query: "cl",
		});
		expect(source.detectTrigger("not /cl", 7)).toBeNull();
		expect(source.detectTrigger("/help arg", 9)).toBeNull();
	});

	it("filters the available commands by the query", () => {
		const ctx = source.detectTrigger("/c", 2)!;
		expect((source.fetchItems(ctx) as SlashCommand[]).map((c) => c.name)).toEqual([
			"clear",
			"compact",
		]);
	});

	it("rewrites the composer to /<name> + space on select", () => {
		const ctx = source.detectTrigger("/cl", 3)!;
		expect(source.onSelect("/cl", ctx, cmd("clear"))).toBe("/clear ");
	});

	it("returns the slash footer instructions", () => {
		expect(source.instructions({ isCreateSelected: false })).toEqual(
			slashInstructions(),
		);
	});

	it("has no create row", () => {
		expect(source.createRow).toBeUndefined();
	});
});

// ── Quick-prompt `!` ─────────────────────────────────────────────────────────

describe("makeQuickPromptSource", () => {
	const prompts = [qp("debrief", "Debrief"), qp("daily", "Daily brief")];
	const source = makeQuickPromptSource(prompts, substringScorer);

	it("is the quick-prompt kind, WRAPS, no guard, owns Enter scope combos", () => {
		expect(source.kind).toBe("quick-prompt");
		expect(source.navPolicy).toBe("wrap");
		expect(source.dismissGuard).toBeUndefined();
		expect(source.capabilities).toEqual({
			dismissOnShiftEnter: false,
			ownsEnterScopeCombos: true,
		});
	});

	it("detects the ! trigger at line start, carrying query + caret + ! index", () => {
		expect(source.detectTrigger("!de", 3)).toEqual({
			start: 0,
			query: "de",
			caret: 3,
		});
		// Line-start after a newline; start = the ! index.
		expect(source.detectTrigger("foo\n!de", 7)).toEqual({
			start: 4,
			query: "de",
			caret: 7,
		});
		// Mid-line ! does NOT trigger.
		expect(source.detectTrigger("hi !de", 6)).toBeNull();
	});

	it("ranks prompts via the injected scorer; empty query → all", () => {
		const all = source.detectTrigger("!", 1)!;
		expect((source.fetchItems(all) as QuickPrompt[]).map((p) => p.id)).toEqual([
			"debrief",
			"daily",
		]);
		const de = source.detectTrigger("!de", 3)!;
		expect(
			(source.fetchItems(de) as QuickPrompt[]).map((p) => p.id),
		).toEqual(["debrief"]); // only "Debrief" contains "de"
	});

	it("strips the !query token on select (engine fires the prompt separately)", () => {
		const ctx = source.detectTrigger("!de", 3)!;
		expect(source.onSelect("!de", ctx, prompts[0])).toBe("");
		const ctx2 = source.detectTrigger("context\n!de", 11)!;
		expect(source.onSelect("context\n!de", ctx2, prompts[0])).toBe(
			"context\n",
		);
	});

	it("builds a create row labeled by the query when there is no draft", () => {
		const ctx = source.detectTrigger("!de", 3)!;
		const items = source.fetchItems(ctx) as QuickPrompt[];
		const row = source.createRow!(ctx, items, "!de");
		expect(row).toEqual({
			kind: "create-prompt",
			query: "de",
			label: 'Create quick prompt "de"',
		});
	});

	it("builds a from-composer create row when a draft survives the token", () => {
		const ctx = source.detectTrigger("context\n!de", 11)!;
		const items = source.fetchItems(ctx) as QuickPrompt[];
		const row = source.createRow!(ctx, items, "context\n!de") as
			| CreatePromptRow
			| null;
		expect(row?.fromComposer).toBe(true);
		expect(row?.label).toBe("Create quick prompt from this message");
	});

	it("shows only the create hint when the create row is selected, else the 2×2 set", () => {
		expect(
			source.instructions({ isCreateSelected: true }).map((i) => i.label),
		).toEqual(["create"]);
		expect(
			source.instructions({ isCreateSelected: false }).map((i) => i.label),
		).toEqual(["run", "new tab", "switch", "insert"]);
	});
});

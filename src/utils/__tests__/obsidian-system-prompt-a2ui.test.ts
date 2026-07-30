/**
 * T12 — the a2ui teaching/advertising channels:
 *
 * 1. The interactive-buttons briefing block joins the Obsidian system prompt
 *    when enabled and disappears when toggled off (the briefing is the
 *    operative channel for generic agents — D9).
 * 2. The `_meta` capability object advertised at ACP initialize embeds the
 *    standard a2uiClientCapabilities shape with the profile catalog id.
 *
 * Briefing content pins the D16 restraint wording (clarifying-choice
 * carve-out) and the D6 profile rules.
 */
import { describe, expect, it } from "vitest";
import {
	composeObsidianSystemPrompt,
	DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
	INTERACTIVE_BUTTONS_BLOCK,
	normalizeObsidianSystemPromptSettings,
} from "../obsidian-system-prompt";
import {
	A2UI_CAPABILITY_META_KEY,
	buildA2uiCapabilityMeta,
} from "../../services/a2ui/capability";
import { BUTTONS_V0_CATALOG_ID, UAX31_IDENTIFIER_PATTERN } from "../../services/a2ui/spec-snapshot";

const CTX = { cwd: "/vault", vaultRoot: "/vault" };

describe("interactive-buttons briefing block (T12)", () => {
	it("is included by default", () => {
		const prompt = composeObsidianSystemPrompt(
			DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
			CTX,
		);
		expect(prompt).toContain("<interactive_controls>");
		expect(prompt).toContain("```a2ui");
	});

	it("is omitted when the block is toggled off", () => {
		const prompt = composeObsidianSystemPrompt(
			{
				...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS,
				blocks: {
					...DEFAULT_OBSIDIAN_SYSTEM_PROMPT_SETTINGS.blocks,
					interactiveButtons: false,
				},
			},
			CTX,
		);
		expect(prompt).not.toContain("<interactive_controls>");
		expect(prompt).not.toContain("a2ui");
	});

	it("teaches the profile contract: version, catalog, one envelope, allowed components", () => {
		expect(INTERACTIVE_BUTTONS_BLOCK).toContain('"v1.0"');
		expect(INTERACTIVE_BUTTONS_BLOCK).toContain(BUTTONS_V0_CATALOG_ID);
		expect(INTERACTIVE_BUTTONS_BLOCK).toContain("EXACTLY ONE");
		expect(INTERACTIVE_BUTTONS_BLOCK).toContain(
			"Text, Row, Column, Card, Button, Divider",
		);
	});

	it("teaches the event-name identifier constraint (A2UI-I05 — V11 rejects hyphens)", () => {
		const flat = INTERACTIVE_BUTTONS_BLOCK.replace(/\s+/g, " ");
		// The block must warn that event names are identifiers, not kebab-case
		// — agents copy the kebab surfaceId style otherwise (A2UI-I05).
		expect(flat).toContain("no hyphens");
		// Every concrete event name in the block (requirements + example) must
		// itself pass the validator's V11 identifier check, so the briefing
		// never models an invalid name. The "..." placeholder is excluded.
		const names = [...INTERACTIVE_BUTTONS_BLOCK.matchAll(/"name":"([^"]*)"/g)]
			.map((m) => m[1])
			.filter((n) => n !== "...");
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			expect(name).toMatch(UAX31_IDENTIFIER_PATTERN);
		}
	});

	it("carries the D16 restraint wording (clarifying-choice carve-out)", () => {
		const flat = INTERACTIVE_BUTTONS_BLOCK.replace(/\s+/g, " ");
		expect(flat).toContain(
			"Never attach buttons to an open-ended or opinion question itself",
		);
		expect(flat).toContain("clarifying choice");
		expect(flat).toContain("When in doubt, reply in prose with no fence");
	});

	it("normalizes a pre-feature persisted config to interactiveButtons on", () => {
		const settings = normalizeObsidianSystemPromptSettings({
			blocks: { hostIdentity: false },
		});
		expect(settings.blocks.interactiveButtons).toBe(true);
		expect(settings.blocks.hostIdentity).toBe(false);
	});

	it("round-trips an explicit false through the normalizer", () => {
		const settings = normalizeObsidianSystemPromptSettings({
			blocks: { interactiveButtons: false },
		});
		expect(settings.blocks.interactiveButtons).toBe(false);
	});
});

describe("a2ui capability meta (T12/D9)", () => {
	it("uses the namespaced key", () => {
		expect(A2UI_CAPABILITY_META_KEY).toBe("agentconsole.dev/a2ui");
	});

	it("embeds the standard a2uiClientCapabilities shape with the profile catalog", () => {
		expect(buildA2uiCapabilityMeta()).toEqual({
			binding: "markdown-jsonl-v0",
			actionTransport: "session/prompt",
			profiles: ["buttons-v0"],
			a2uiClientCapabilities: {
				"v1.0": {
					supportedCatalogIds: [BUTTONS_V0_CATALOG_ID],
				},
			},
		});
	});
});

/**
 * D9 — the ACP-initialization capability advertisement for the a2ui binding.
 *
 * Embeds A2UI's STANDARD `a2uiClientCapabilities` object (per the spec's
 * client_capabilities.json) plus binding-specific fields, under a namespaced
 * `_meta` key — so a future public proposal stays aligned with A2UI's own
 * capability schema. Generic harnesses don't surface initialize `_meta` to
 * the model; the system-prompt briefing block is the operative channel for
 * them (see utils/obsidian-system-prompt.ts).
 */
import { A2UI_VERSION, BUTTONS_V0_CATALOG_ID } from "./spec-snapshot";

export const A2UI_CAPABILITY_META_KEY = "agentconsole.dev/a2ui";

export interface A2uiCapabilityMeta {
	binding: string;
	actionTransport: string;
	profiles: string[];
	a2uiClientCapabilities: Record<string, { supportedCatalogIds: string[] }>;
}

export function buildA2uiCapabilityMeta(): A2uiCapabilityMeta {
	return {
		binding: "markdown-jsonl-v0",
		actionTransport: "session/prompt",
		profiles: ["buttons-v0"],
		a2uiClientCapabilities: {
			[A2UI_VERSION]: {
				supportedCatalogIds: [BUTTONS_V0_CATALOG_ID],
			},
		},
	};
}

/**
 * Action construction for buttons-v0 (T02, D8, D14).
 *
 * Activation produces a standard A2UI client-to-server `action` envelope,
 * wrapped in an ordinary user prompt: one human-readable summary line plus
 * the canonical fence. The summary shown in chat is derived from the ACTUAL
 * payload (action name + resolved context) — never from agent-supplied
 * display text alone — so a deceptive button label is discoverable at the
 * point of send (spec § Safety boundary #9, D14).
 *
 * Pure — no React, no Obsidian, no clock (timestamp injected).
 */
import { A2UI_VERSION } from "./spec-snapshot";
import type { A2uiComponent } from "./types";

export type A2uiButton = Extract<A2uiComponent, { kind: "button" }>;

export interface A2uiActionInput {
	surfaceId: string;
	button: A2uiButton;
	/** ISO 8601 timestamp of the activation (injected for purity). */
	timestamp: string;
}

/** The canonical single-line v1.0 `action` envelope (JSONL framing). */
export function buildA2uiActionEnvelope(input: A2uiActionInput): string {
	return JSON.stringify({
		version: A2UI_VERSION,
		action: {
			name: input.button.event.name,
			surfaceId: input.surfaceId,
			sourceComponentId: input.button.id,
			timestamp: input.timestamp,
			context: input.button.event.context,
		},
	});
}

/**
 * The full user message sent through the normal ACP prompt path: a summary
 * line a non-rendering reader understands, plus the canonical envelope so
 * replay in any client stays legible (spec § Client to agent).
 */
export function buildA2uiActionUserMessage(input: A2uiActionInput): string {
	const label = input.button.label.trim();
	const summary = label.length > 0 ? label : input.button.event.name;
	return `Selected: ${summary}\n\n\`\`\`a2ui\n${buildA2uiActionEnvelope(input)}\n\`\`\``;
}

/**
 * D14 — the compact display summary for the stored action message: label as
 * decoration, payload truth (event name + literal context) always present so
 * a label/payload mismatch is visible.
 */
export function formatA2uiActionSummary(button: A2uiButton): string {
	const context = Object.entries(button.event.context)
		.map(([key, value]) => `${key}: ${String(value)}`)
		.join(", ");
	const payload =
		context.length > 0
			? `${button.event.name} (${context})`
			: button.event.name;
	const label = button.label.trim();
	return label.length > 0 ? `${label} — ${payload}` : payload;
}

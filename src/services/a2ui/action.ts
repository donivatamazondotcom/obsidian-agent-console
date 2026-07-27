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
import { extractA2uiFences } from "./fence-extractor";
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

/**
 * Payload-derived summary for a STORED action fence body (the user message
 * in the transcript): "name (k: v, …)". Returns null when the body is not a
 * single-line action envelope — callers fall back to plain rendering.
 * Total: never throws.
 */
export function summarizeA2uiActionBody(body: string): string | null {
	const lines = body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (lines.length !== 1) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(lines[0]);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const action = (parsed as Record<string, unknown>).action;
	if (typeof action !== "object" || action === null) return null;
	const { name, context } = action as Record<string, unknown>;
	if (typeof name !== "string") return null;
	const pairs =
		typeof context === "object" && context !== null
			? Object.entries(context as Record<string, unknown>)
					.filter(([, v]) => typeof v !== "object")
					.map(([k, v]) => `${k}: ${String(v)}`)
					.join(", ")
			: "";
	return pairs.length > 0 ? `${name} (${pairs})` : name;
}

/**
 * I179 — the single resolver for "is this user text an a2ui action message,
 * and how does it render compactly?"
 *
 * TWO consumers read this and must never disagree:
 *
 *  1. `UserTextWithActions` — renders the compact body (summary line +
 *     canonical envelope behind a disclosure, D14).
 *  2. `MessageBubble` — applies the `agent-client-message-a2ui-action`
 *     modifier class to the message-renderer element, which is what the
 *     A2UI-I04 alignment rule keys off (16px margins so the answer card lines
 *     up under the surface card that produced it).
 *
 * Consumer 2 previously read the DOM instead, via a CSS `:has` pseudo-class.
 * Obsidian's plugin review lints that as a performance risk (broad selector
 * invalidation), so the condition is resolved here in code and published as a
 * class. Both consumers call this function — the decision is never re-derived.
 *
 * Returns null when the text is not a renderable action message (no fence, an
 * unclosed streaming partial, a non-action envelope, or malformed JSON), so
 * callers fall back to plain rendering.
 *
 * Pure and total: any string in, view-or-null out, never throws.
 */
export interface A2uiActionMessageView {
	/** Text before the fence, trailing whitespace trimmed. */
	before: string;
	/** Text after the fence, leading whitespace trimmed. */
	after: string;
	/** Payload-derived disclosure summary: "name (k: v, …)" (D14). */
	summary: string;
	/** The canonical envelope body, verbatim. */
	body: string;
}

export function deriveA2uiActionMessageView(
	text: string,
): A2uiActionMessageView | null {
	const fence = extractA2uiFences(text)
		.filter((f) => f.closed)
		.find((f) => summarizeA2uiActionBody(f.body) !== null);
	if (fence === undefined) return null;
	return {
		before: text.slice(0, fence.start).trimEnd(),
		after: text.slice(fence.end).trimStart(),
		// Non-null by the find predicate above.
		summary: summarizeA2uiActionBody(fence.body) as string,
		body: fence.body,
	};
}

/**
 * T02 seed — the exact v1.0 `action` envelope built on activation, the sent
 * user-message markdown (summary line + canonical fence), and the
 * client-derived display summary (D14: derived from the payload, label is
 * decoration only — a deceptive button label is visible at the point of send).
 */
import { describe, expect, it } from "vitest";
import {
	buildA2uiActionEnvelope,
	buildA2uiActionUserMessage,
	formatA2uiActionSummary,
} from "../action";
import type { A2uiComponent } from "../types";

const BUTTON: Extract<A2uiComponent, { kind: "button" }> = {
	kind: "button",
	id: "complete",
	child: "complete-label",
	label: "Complete migration",
	event: { name: "choose_scope", context: { scope: "complete" } },
};

const WHEN = "2026-07-16T09:00:00.000Z";

describe("buildA2uiActionEnvelope", () => {
	it("builds the exact v1.0 action shape", () => {
		const envelope = buildA2uiActionEnvelope({
			surfaceId: "migration-scope-7f3a",
			button: BUTTON,
			timestamp: WHEN,
		});
		expect(JSON.parse(envelope)).toEqual({
			version: "v1.0",
			action: {
				name: "choose_scope",
				surfaceId: "migration-scope-7f3a",
				sourceComponentId: "complete",
				timestamp: WHEN,
				context: { scope: "complete" },
			},
		});
	});

	it("serializes to a single line (JSONL framing)", () => {
		const envelope = buildA2uiActionEnvelope({
			surfaceId: "s-1a2b",
			button: BUTTON,
			timestamp: WHEN,
		});
		expect(envelope).not.toContain("\n");
	});

	it("carries empty context as an empty object, not undefined", () => {
		const envelope = buildA2uiActionEnvelope({
			surfaceId: "s-1a2b",
			button: { ...BUTTON, event: { name: "go", context: {} } },
			timestamp: WHEN,
		});
		expect(JSON.parse(envelope).action.context).toEqual({});
	});
});

describe("buildA2uiActionUserMessage", () => {
	it("is a summary line plus the canonical fence", () => {
		const message = buildA2uiActionUserMessage({
			surfaceId: "migration-scope-7f3a",
			button: BUTTON,
			timestamp: WHEN,
		});
		const [first] = message.split("\n");
		expect(first).toBe("Selected: Complete migration");
		expect(message).toContain("```a2ui\n");
		expect(message.trimEnd().endsWith("```")).toBe(true);
		// The fence body must be the canonical envelope.
		const body = /```a2ui\n(.*)\n```/.exec(message)?.[1];
		expect(body).toBeDefined();
		expect(JSON.parse(body as string).action.surfaceId).toBe(
			"migration-scope-7f3a",
		);
	});

	it("stays legible when the label is empty", () => {
		const message = buildA2uiActionUserMessage({
			surfaceId: "s-1a2b",
			button: { ...BUTTON, label: "" },
			timestamp: WHEN,
		});
		expect(message.split("\n")[0]).toBe("Selected: choose_scope");
	});
});

describe("formatA2uiActionSummary (D14 — payload-derived)", () => {
	it("derives from the action name and context, with the label as decoration", () => {
		const summary = formatA2uiActionSummary(BUTTON);
		// Payload truth must be present regardless of the label.
		expect(summary).toContain("choose_scope");
		expect(summary).toContain("scope: complete");
		// Label appears as decoration.
		expect(summary).toContain("Complete migration");
	});

	it("exposes a label/payload mismatch (deceptive-label detection)", () => {
		const deceptive = {
			...BUTTON,
			label: "Cancel",
			event: {
				name: "delete_everything",
				context: { target: "all-files" },
			},
		};
		const summary = formatA2uiActionSummary(deceptive);
		expect(summary).toContain("delete_everything");
		expect(summary).toContain("target: all-files");
	});

	it("renders context-free actions without a dangling separator", () => {
		const summary = formatA2uiActionSummary({
			...BUTTON,
			label: "Go",
			event: { name: "go", context: {} },
		});
		expect(summary).toBe("Go — go");
	});

	it("renders boolean and numeric literals", () => {
		const summary = formatA2uiActionSummary({
			...BUTTON,
			event: { name: "set", context: { count: 3, force: true } },
		});
		expect(summary).toContain("count: 3");
		expect(summary).toContain("force: true");
	});
});

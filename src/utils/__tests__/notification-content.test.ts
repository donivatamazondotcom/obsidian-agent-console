import { describe, it, expect } from "vitest";
import {
	buildCompletionNotificationContent,
	COMPLETION_NOTIFICATION_FALLBACK_TITLE,
} from "../notification-content";

describe("buildCompletionNotificationContent", () => {
	it("uses the tab label as the title when present", () => {
		const c = buildCompletionNotificationContent({
			tabLabel: "Fix scroll jitter",
			agentLabel: "Claude Code",
		});
		expect(c.title).toBe("Fix scroll jitter");
	});

	it("falls back to the plugin name when the tab label is missing", () => {
		const c = buildCompletionNotificationContent({
			agentLabel: "Claude Code",
		});
		expect(c.title).toBe(COMPLETION_NOTIFICATION_FALLBACK_TITLE);
	});

	it("falls back when the tab label is blank/whitespace", () => {
		const c = buildCompletionNotificationContent({
			tabLabel: "   ",
			agentLabel: "Claude Code",
		});
		expect(c.title).toBe(COMPLETION_NOTIFICATION_FALLBACK_TITLE);
	});

	it("body names the agent that finished", () => {
		const c = buildCompletionNotificationContent({
			tabLabel: "Draft release notes",
			agentLabel: "Gemini CLI",
		});
		expect(c.body).toBe("Gemini CLI · response complete");
	});

	it("carries no tag: the notification registry assigns a fresh one per notification (I52 round 9)", () => {
		const c = buildCompletionNotificationContent({
			tabLabel: "x",
			agentLabel: "y",
		});
		expect(c).not.toHaveProperty("tag");
	});
});

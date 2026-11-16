/**
 * Chat ID — `plugin.ts` wiring for `obsidian://agent-console-chat`
 * ([[Agent Console Chat ID]] § Architecture impact, D12, D14).
 *
 * Source-order guard: plugin.ts has no unit harness, so this pins in the
 * shipped source that the chat-link action is registered in onload's boot
 * parts (the guarded `runRegistrations` list), next to the quick-prompt one,
 * and that the handler's rate-limit holder reads and writes the plugin's own
 * `chatLinkRateLimit`, never the quick-prompt `uriRateLimit` (D14). The
 * handler's behaviour is covered by chat-link-handler.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "src/plugin.ts"), "utf8");

function body(startMarker: string, endMarker: string): string {
	const start = src.indexOf(startMarker);
	expect(start, `missing ${startMarker}`).toBeGreaterThanOrEqual(0);
	const end = src.indexOf(endMarker, start);
	expect(end, `missing ${endMarker} after ${startMarker}`).toBeGreaterThan(start);
	return src.slice(start, end);
}

describe("chat-link wiring in plugin.ts (Chat ID)", () => {
	it("registers the chat-link action in onload's boot parts, after the quick-prompt one", () => {
		const onload = body("async onload()", "\n\tonunload()");
		const boot = body("runRegistrations(", "logError: (message, error)");
		expect(onload).toContain(boot);
		const quick = boot.search(
			/registerObsidianProtocolHandler\(\s*QUICK_PROMPT_URI_ACTION/,
		);
		const chat = boot.search(
			/registerObsidianProtocolHandler\(\s*CHAT_LINK_ACTION,\s*\(params\)\s*=>\s*\{\s*void this\.chatLinkHandler\(params\);/,
		);
		expect(quick).toBeGreaterThan(-1);
		expect(chat).toBeGreaterThan(quick);
		// Its own boot part, so a failing quick-prompt registration can't skip it.
		const between = boot.slice(quick, chat);
		expect(between).toMatch(/label:\s*t\("notices\.bootPartUriHandler"\)/);
	});

	it("builds the handler once, with a rate-limit holder over chatLinkRateLimit only", () => {
		const create = body("createChatLinkHandler<WorkspaceLeaf>(", "\n\t\t});");
		expect(create).toMatch(/get:\s*\(\)\s*=>\s*this\.chatLinkRateLimit/);
		expect(create).toMatch(/this\.chatLinkRateLimit\s*=\s*state/);
		expect(create).not.toContain("uriRateLimit");
		// The wait deadline needs a main-window timer (Chat ID D15).
		expect(create).toMatch(
			/sleep:\s*\(ms\)\s*=>\s*new Promise<void>\(\(resolve\)\s*=>\s*window\.setTimeout\(resolve, ms\)\)/,
		);
		expect(src.match(/createChatLinkHandler<WorkspaceLeaf>\(/g)).toHaveLength(1);
		expect(src).toMatch(/private chatLinkRateLimit: ChatLinkRateLimitState = \{\};/);
	});

	it("reads a leaf's bridge only through a mounted ChatView", () => {
		const create = body("createChatLinkHandler<WorkspaceLeaf>(", "\n\t\t});");
		expect(create).toMatch(
			/getBridge:\s*\(leaf\)\s*=>\s*leaf\.view instanceof ChatView \? leaf\.view\.getOpenChat\(\) : null/,
		);
	});
});

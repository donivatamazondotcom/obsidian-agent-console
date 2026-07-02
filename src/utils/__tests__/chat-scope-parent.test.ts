import { describe, it, expect } from "vitest";
import { Scope } from "obsidian";
import { resolveChatPushScopeParent } from "../chat-scope-parent";

describe("resolveChatPushScopeParent (I155)", () => {
	it("parents the pushed scope to the view scope when one exists", () => {
		// Regression guard for I155: the chat UI's pushed scope MUST be parented
		// to the view scope (not the app root), so an unhandled Cmd+W falls
		// through to ChatView's confirm-close handler. The pre-fix code parented
		// to the app root scope, which is exactly what this forbids.
		const viewScope = new Scope();
		const appScope = new Scope();
		expect(resolveChatPushScopeParent(viewScope, appScope)).toBe(viewScope);
		expect(resolveChatPushScopeParent(viewScope, appScope)).not.toBe(
			appScope,
		);
	});

	it("falls back to the app root scope when the view has no scope", () => {
		const appScope = new Scope();
		expect(resolveChatPushScopeParent(null, appScope)).toBe(appScope);
	});
});

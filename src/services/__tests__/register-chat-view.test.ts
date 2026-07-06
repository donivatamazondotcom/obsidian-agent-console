import { describe, it, expect, vi } from "vitest";
import { registerChatViewSafely } from "../register-chat-view";
import { VIEW_TYPE_CHAT } from "../../ui/chat-view-type";

describe("I157 — registerChatViewSafely (crash-class regression guard)", () => {
	it("registers the chat view and returns true on success", () => {
		const registerView = vi.fn();
		const notify = vi.fn();
		const creator = vi.fn();
		const ok = registerChatViewSafely({ registerView }, creator, notify);
		expect(ok).toBe(true);
		expect(registerView).toHaveBeenCalledWith(VIEW_TYPE_CHAT, creator);
		expect(notify).not.toHaveBeenCalled();
	});

	it("catches a duplicate-view-type collision, notifies plainly, and does not throw", () => {
		// Reproduces the I157 failure shape: Obsidian throws when the view type
		// is already registered (by the upstream Agent Client plugin).
		const registerView = vi.fn(() => {
			throw new Error(
				`Attempting to register an existing view type "${VIEW_TYPE_CHAT}"`,
			);
		});
		const notify = vi.fn();
		const logError = vi.fn();
		let ok: boolean | undefined;
		expect(() => {
			ok = registerChatViewSafely(
				{ registerView },
				vi.fn(),
				notify,
				logError,
			);
		}).not.toThrow();
		expect(ok).toBe(false);
		expect(notify).toHaveBeenCalledOnce();
		// Plain-language message, no internal jargon.
		expect(notify.mock.calls[0][0]).toMatch(/disable one of the two plugins/i);
		expect(logError).toHaveBeenCalledOnce();
	});
});

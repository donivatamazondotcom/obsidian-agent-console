/**
 * I300 (review L1): after the "What's new" card's Dismiss unmounts, focus goes
 * to the active composer, or to the view's first visible control when there
 * is none (the no-agent landing) – never <body>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleViewRefocus } from "../composer-focus";

beforeEach(() => {
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
		cb(0);
		return 0;
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function view(html: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = html;
	document.body.appendChild(el);
	return el;
}

describe("I300 scheduleViewRefocus", () => {
	it("focuses the active tab's composer", () => {
		const v = view(
			'<div style="display:none"><textarea class="agent-client-chat-input-textarea" id="hidden"></textarea></div>' +
				'<div><textarea class="agent-client-chat-input-textarea" id="active"></textarea></div>',
		);
		scheduleViewRefocus(v);
		expect(document.activeElement?.id).toBe("active");
	});

	it("with no composer, focuses the first visible control", () => {
		const v = view(
			'<div style="display:none"><button id="hidden">x</button></div>' +
				'<div><button id="install">Install</button></div>',
		);
		scheduleViewRefocus(v);
		expect(document.activeElement?.id).toBe("install");
	});

	it("does nothing for a missing container", () => {
		expect(() => scheduleViewRefocus(null)).not.toThrow();
	});
});

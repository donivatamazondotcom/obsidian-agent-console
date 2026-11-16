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

	it("skips a control that refuses focus (hidden by a stylesheet) and takes the next", () => {
		const v = view(
			'<div><button id="css-hidden">x</button></div>' +
				'<div><button id="install">Install</button></div>',
		);
		const hidden = v.querySelector<HTMLButtonElement>("#css-hidden")!;
		// jsdom has no layout; model a stylesheet-hidden button refusing focus.
		hidden.focus = () => {};
		scheduleViewRefocus(v);
		expect(document.activeElement?.id).toBe("install");
	});

	it("does nothing for a missing container", () => {
		expect(() => scheduleViewRefocus(null)).not.toThrow();
	});
});

describe("I358 scheduleViewRefocus guards", () => {
	it("T9: a popout container uses its own window's frame and its own document's focus", () => {
		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		const win = frame.contentWindow as Window & typeof globalThis;
		const doc = frame.contentDocument as Document;
		const popoutRaf = vi
			.spyOn(win, "requestAnimationFrame")
			.mockImplementation((cb) => {
				cb(0);
				return 0;
			});
		const host = doc.createElement("div");
		host.innerHTML = '<textarea class="agent-client-chat-input-textarea" id="popout"></textarea>';
		doc.body.appendChild(host);
		// The main window's focus is elsewhere; the popout's is on its body.
		const mainButton = document.createElement("button");
		document.body.appendChild(mainButton);
		mainButton.focus();
		expect(document.activeElement).toBe(mainButton);

		scheduleViewRefocus(host);

		expect(popoutRaf).toHaveBeenCalledTimes(1);
		expect(doc.activeElement?.id).toBe("popout");
	});

	it("T10: does nothing when focus already moved to another element", () => {
		const v = view('<div><textarea class="agent-client-chat-input-textarea" id="active"></textarea></div>');
		const other = document.createElement("button");
		document.body.appendChild(other);
		other.focus();
		scheduleViewRefocus(v);
		expect(document.activeElement).toBe(other);
	});

	it("T11: does nothing for a hidden container (a background tab)", () => {
		const wrapper = view('<div><textarea class="agent-client-chat-input-textarea" id="hidden"></textarea></div>');
		wrapper.style.display = "none";
		scheduleViewRefocus(wrapper.firstElementChild as HTMLElement);
		expect(document.activeElement).toBe(document.body);
	});

	it("T11b: does nothing for a container that was removed (a closed tab)", () => {
		const v = view('<div><textarea class="agent-client-chat-input-textarea" id="gone"></textarea></div>');
		v.remove();
		scheduleViewRefocus(v);
		expect(document.activeElement).toBe(document.body);
		expect(v.querySelector("textarea")).not.toBe(document.activeElement);
	});
});

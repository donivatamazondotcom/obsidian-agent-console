/**
 * Tab rename commit → focus returns to the composer (TS-I09).
 *
 * Right-clicking a tab focuses it (`div role="tab"` is focusable); when the
 * rename modal closes, Obsidian restores focus to that tab. Found in the TS-I08
 * smoke pass once the tab focus ring made it visible: after renaming, the user
 * had to click back into the composer to type.
 *
 * `commitTabRename` is the save step of ChatView's rename flow (duplicate check
 * → apply label + persist → focus contract). Asserted against a real DOM: the
 * ACTIVE tab's composer (not a hidden background tab's) ends up focused.
 *
 * Reproduce-first: `tab-rename.ts` does not exist and `rename-tab` is not a
 * ComposerAction on `main` @ 4cadbd7 → red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { commitTabRename } from "../tab-rename";
import { scheduleComposerRefocus } from "../composer-focus";

function flushFrame(): Promise<void> {
	return new Promise((r) => window.requestAnimationFrame(() => r()));
}

let container: HTMLElement;
let activeComposer: HTMLTextAreaElement;
let tabEl: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	// Hidden background tab + visible active tab, as ChatComponent renders them.
	container.innerHTML = `
		<div class="agent-client-tab" role="tab" tabindex="0"></div>
		<div style="display:none"><textarea class="agent-client-chat-input-textarea" data-tab="bg"></textarea></div>
		<div><textarea class="agent-client-chat-input-textarea" data-tab="active"></textarea></div>`;
	document.body.appendChild(container);
	activeComposer = container.querySelector('[data-tab="active"]')!;
	tabEl = container.querySelector('[role="tab"]')!;
	// Where Obsidian's modal-close focus restore leaves things.
	tabEl.focus();
});

afterEach(() => container.remove());

const tabs = [
	{ tabId: "t1", label: "Japan trip planning" },
	{ tabId: "t2", label: "Auth refactor" },
];

function run(newTitle: string) {
	const apply = vi.fn(() => Promise.resolve());
	const notifyDuplicate = vi.fn();
	const result = commitTabRename({
		tabId: "t1",
		newTitle,
		tabs,
		truncate: (s) => s,
		apply,
		notifyDuplicate,
		refocus: () => scheduleComposerRefocus(container),
	});
	return { result, apply, notifyDuplicate };
}

describe("commitTabRename (TS-I09)", () => {
	it("saves the label and returns focus to the active tab's composer", async () => {
		const { result, apply } = run("Japan renamed");
		expect(result).toBe("saved");
		expect(apply).toHaveBeenCalledWith("Japan renamed");
		await flushFrame();
		expect(document.activeElement).toBe(activeComposer);
	});

	it("on a duplicate name: no save, no refocus, user is told", async () => {
		const { result, apply, notifyDuplicate } = run("Auth refactor");
		expect(result).toBe("duplicate");
		expect(apply).not.toHaveBeenCalled();
		expect(notifyDuplicate).toHaveBeenCalledOnce();
		await flushFrame();
		expect(document.activeElement).toBe(tabEl);
	});

	it("refocuses without waiting for persistence to finish", async () => {
		let resolvePersist: () => void = () => {};
		commitTabRename({
			tabId: "t1",
			newTitle: "Slow disk",
			tabs,
			truncate: (s) => s,
			apply: () => new Promise<void>((r) => (resolvePersist = r)),
			notifyDuplicate: vi.fn(),
			refocus: () => scheduleComposerRefocus(container),
		});
		await flushFrame();
		expect(document.activeElement).toBe(activeComposer);
		resolvePersist();
	});
});

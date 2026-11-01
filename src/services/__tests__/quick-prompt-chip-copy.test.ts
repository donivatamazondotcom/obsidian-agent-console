/**
 * I234 — focus returns to the composer after a chip menu Copy prompt / Copy
 * link. Before the fix, neither copy branch of `runQuickPromptChipAction`
 * moved focus back, so the user had to click into the composer again.
 *
 * Outcome assertion (R3): a real composer textarea inside a real tab-panel
 * structure, the real `scheduleComposerRefocus`, and `document.activeElement`
 * checked after the frame. Only the clipboard and notices are injected (the
 * browser/Obsidian boundary).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChipCopy } from "../quick-prompt-chip-copy";
import { scheduleComposerRefocus } from "../../ui/composer-focus";

const PROMPT = { id: "test-debrief", body: "Debrief this meeting." };

let container: HTMLElement;
let activeComposer: HTMLTextAreaElement;
let chip: HTMLButtonElement;

function mountView() {
	container = document.createElement("div");
	container.className = "agent-client-chat-view-container";
	// A hidden background tab first, then the active one — the refocus must
	// land on the ACTIVE tab's composer, not the first in the DOM.
	const hidden = document.createElement("div");
	hidden.style.display = "none";
	const hiddenTa = document.createElement("textarea");
	hiddenTa.className = "agent-client-chat-input-textarea";
	hidden.appendChild(hiddenTa);
	const active = document.createElement("div");
	activeComposer = document.createElement("textarea");
	activeComposer.className = "agent-client-chat-input-textarea";
	active.appendChild(activeComposer);
	chip = document.createElement("button");
	active.appendChild(chip);
	container.append(hidden, active);
	document.body.appendChild(container);
}

async function nextFrame() {
	await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
}

beforeEach(() => {
	mountView();
	chip.focus(); // the menu was opened from the chip
});
afterEach(() => container.remove());

function deps(writeText: (t: string) => Promise<void>) {
	return {
		writeText,
		notify: vi.fn(),
		logError: vi.fn(),
		vaultName: "My Vault",
		refocus: () => scheduleComposerRefocus(container),
	};
}

describe("I234: chip menu copy actions return focus to the composer", () => {
	it("Copy prompt copies the body and focus lands in the active composer", async () => {
		let clip = "";
		const d = deps(async (t) => {
			clip = t;
		});
		await runChipCopy("copy", PROMPT, d);
		await nextFrame();
		expect(clip).toBe("Debrief this meeting.");
		expect(document.activeElement).toBe(activeComposer);
	});

	it("Copy link copies the prompt link and focus lands in the active composer", async () => {
		let clip = "";
		const d = deps(async (t) => {
			clip = t;
		});
		await runChipCopy("copy-link", PROMPT, d);
		await nextFrame();
		expect(clip).toBe(
			"obsidian://agent-console?vault=My%20Vault&prompt=test-debrief",
		);
		expect(document.activeElement).toBe(activeComposer);
	});

	it("focus still returns when the clipboard write fails, and the failure is reported", async () => {
		const d = deps(async () => {
			throw new Error("denied");
		});
		await runChipCopy("copy-link", PROMPT, d);
		await nextFrame();
		expect(d.notify).toHaveBeenCalledWith(
			expect.stringContaining("Couldn't copy the prompt link"),
		);
		expect(document.activeElement).toBe(activeComposer);
	});
});

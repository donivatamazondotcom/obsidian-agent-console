/**
 * Open chat → focus the ACTIVE tab's composer.
 *
 * Spec: [[I136 Open chat does not focus the composer]].
 *
 * Root cause (H1): the view-activate path focused the composer with
 * `containerEl.querySelector("textarea.agent-client-chat-input-textarea")`,
 * which returns the FIRST match in the DOM. Tabs are kept mounted with inactive
 * ones hidden via display:none (I19), so first-match focuses a BACKGROUND tab's
 * composer — `.focus()` on it does not land the user in the active composer.
 *
 * The fix: `focusActiveTabComposer` skips composers inside a display:none
 * subtree (inactive tabs) and focuses the active tab's composer at end via the
 * shared, tested `focusComposerAtEnd` primitive. This test pins the active-tab
 * contract; the live reveal + setActiveLeaf focus behaviour (H2/H3) is verified
 * by the human smoke test because jsdom cannot model leaf reveal or Obsidian's
 * focus handling.
 */
import { describe, it, expect, afterEach } from "vitest";
import { focusActiveTabComposer } from "../composer-focus";

function makeComposer(value: string): HTMLTextAreaElement {
	const el = document.createElement("textarea");
	el.className = "agent-client-chat-input-textarea";
	el.value = value;
	return el;
}

/** A view container with an inactive (display:none) tab first, active tab second. */
function makeTwoTabView(): {
	container: HTMLElement;
	background: HTMLTextAreaElement;
	active: HTMLTextAreaElement;
} {
	const container = document.createElement("div");

	const backgroundTab = document.createElement("div");
	backgroundTab.style.display = "none"; // inactive tab, kept mounted (I19)
	const background = makeComposer("background draft");
	backgroundTab.append(background);

	const activeTab = document.createElement("div"); // visible/active tab
	const active = makeComposer("active draft");
	activeTab.append(active);

	container.append(backgroundTab, activeTab);
	document.body.append(container);
	return { container, background, active };
}

describe("focusActiveTabComposer (I136)", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("focuses the ACTIVE tab's composer, not the first (background) DOM match", () => {
		const { container, background, active } = makeTwoTabView();

		focusActiveTabComposer(container);

		expect(document.activeElement).toBe(active);
		expect(document.activeElement).not.toBe(background);
	});

	it("places the caret at the end of the active composer's value", () => {
		const { container, active } = makeTwoTabView();

		focusActiveTabComposer(container);

		expect(active.selectionStart).toBe(active.value.length);
		expect(active.selectionEnd).toBe(active.value.length);
	});

	it("focuses a single mounted composer (freshly opened panel, one tab)", () => {
		const container = document.createElement("div");
		const only = makeComposer("");
		container.append(only);
		document.body.append(container);

		focusActiveTabComposer(container);

		expect(document.activeElement).toBe(only);
	});

	it("no-ops when no composer is mounted (e.g. agent launcher state)", () => {
		const container = document.createElement("div");
		document.body.append(container);

		expect(() => focusActiveTabComposer(container)).not.toThrow();
	});
});

/**
 * Message copy button visible on keyboard focus (I364).
 *
 * Each bubble's actions bar (`.agent-client-message-actions`) is hidden at
 * rest (`opacity: 0; pointer-events: none`) and was revealed only by
 * `.agent-client-message-renderer:hover`. Nothing revealed it on keyboard
 * focus, so Tab landed on an invisible copy button: the chat scrolled to it
 * and nothing looked focused.
 *
 * The reveal is scoped to focus inside the bar itself
 * (`.agent-client-message-actions:focus-within`), not to focus anywhere in
 * the message: a keyboard "Jump to start of latest reply" focuses the
 * reply's text start inside the same renderer, and that must not pop the
 * bar. No `:has()` (the review bot has flagged it before).
 *
 * jsdom applies no cascade, so this reads the shipped stylesheet with
 * postcss, collects every rule that reveals the bar, and checks those
 * selectors against the real MessageBubble's DOM with focus placed the way
 * the runtime places it. Companion check: the (ST) note's CDP probe reads
 * the bar's computed opacity after a real Tab in Obsidian.
 *
 * jsdom limit: its selector engine caches a `:focus-within` result per
 * element and selector, and a focus change doesn't clear it (a second
 * `matches` after `blur()` returns the first answer). An attribute change
 * does clear it, so `freshMatch` touches a data attribute on the bar
 * before every evaluation.
 *
 * Reproduce-first: on `main` @ 211b836d the only reveal is `:hover` → red.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		MarkdownRenderer: {
			render: vi.fn((_app: unknown, text: string, el: HTMLElement) => {
				el.textContent = text;
				return Promise.resolve();
			}),
		},
	};
});

import { MessageBubble } from "../ui/MessageBubble";
import type { ChatMessage, MessageContent } from "../types/chat";
import {
	makeIdleMcpAuthManager,
	makeMessageListPlugin,
} from "../__test_stubs__/message-list-plugin";

afterEach(cleanup);

const BAR = ".agent-client-message-actions";

const root = postcss.parse(
	readFileSync(resolve(process.cwd(), "styles.css"), "utf8"),
);

/**
 * Selectors of every rule, at any depth (including `@media`), that targets
 * the bar and sets the given property to a value other than the hidden one.
 */
function barSelectorsSetting(prop: string, hidden: string): string[] {
	const out: string[] = [];
	root.walkRules((rule: Rule) => {
		let value: string | undefined;
		rule.walkDecls(prop, (d) => {
			value = d.value.trim();
		});
		if (value === undefined || value === hidden) return;
		for (const sel of rule.selectors) {
			const s = sel.trim();
			if (s.endsWith(BAR) || s.includes(`${BAR}:`)) out.push(s);
		}
	});
	return out;
}

/** Rules that make the bar visible. */
const revealSelectors = () => barSelectorsSetting("opacity", "0");
/** Rules that make the bar clickable. */
const clickableSelectors = () => barSelectorsSetting("pointer-events", "none");

/**
 * True when some selector matches `el` right now. Touching an attribute
 * first clears jsdom's stale `:focus-within` cache (see the docblock). A
 * selector jsdom can't parse throws, so a hidden-state case can't pass
 * vacuously.
 */
function freshMatch(el: Element, selectors: string[]): boolean {
	el.setAttribute("data-i364-probe", String(Math.random()));
	el.removeAttribute("data-i364-probe");
	return selectors.some((sel) => el.matches(sel));
}

const isRevealed = (bar: Element) => freshMatch(bar, revealSelectors());
const isClickable = (bar: Element) => freshMatch(bar, clickableSelectors());

const plugin = makeMessageListPlugin({
	settings: { displaySettings: { showEmojis: false } },
	mcpAuthManager: makeIdleMcpAuthManager(),
	app: {
		workspace: { getActiveFile: () => null },
		vault: { adapter: {} },
	},
});

async function bubble(role: "user" | "assistant", content: MessageContent[]) {
	const message: ChatMessage = {
		id: "m1",
		role,
		content,
		timestamp: new Date(0),
	};
	const view = render(<MessageBubble message={message} plugin={plugin} />);
	await act(async () => {
		await Promise.resolve(); // the markdown render resolves
	});
	const bar = view.container.querySelector(BAR);
	const button = bar?.querySelector("button");
	if (!bar || !button) throw new Error("actions bar or copy button missing");
	return { container: view.container, bar, button };
}

describe("message actions bar reveal on keyboard focus (I364)", () => {
	it.each(["assistant", "user"] as const)(
		"shows the %s bubble's bar while its copy button has focus",
		async (role) => {
			const { bar, button } = await bubble(role, [
				{ type: "text", text: "Some reply text." },
			]);
			expect(isRevealed(bar)).toBe(false);
			button.focus();
			expect(document.activeElement).toBe(button);
			expect(isRevealed(bar)).toBe(true);
			expect(isClickable(bar)).toBe(true);
		},
	);

	it("hides the bar again once focus leaves the copy button", async () => {
		const { bar, button } = await bubble("assistant", [
			{ type: "text", text: "Some reply text." },
		]);
		button.focus();
		expect(isRevealed(bar)).toBe(true);
		button.blur();
		expect(document.activeElement).not.toBe(button);
		expect(isRevealed(bar)).toBe(false);
		expect(isClickable(bar)).toBe(false);
	});

	it("keeps the bar hidden at rest (no focus, no hover)", async () => {
		const { bar } = await bubble("assistant", [
			{ type: "text", text: "Some reply text." },
		]);
		expect(isRevealed(bar)).toBe(false);
	});

	it("keeps the bar hidden when a keyboard jump focuses the reply text", async () => {
		const { container, bar } = await bubble("assistant", [
			{ type: "text", text: "The answer." },
		]);
		// Same as MessageList's onJump on keyboard activation.
		const target = container.querySelector<HTMLElement>(
			"[data-reply-text-start]",
		);
		if (!target) throw new Error("reply text start missing");
		target.tabIndex = -1;
		target.focus();
		expect(document.activeElement).toBe(target);
		expect(isRevealed(bar)).toBe(false);
	});

	it("still reveals the bar on pointer hover over the message", () => {
		expect(revealSelectors()).toContain(
			`.agent-client-message-renderer:hover ${BAR}`,
		);
	});

	it("does not use :has() for the reveal", () => {
		for (const sel of revealSelectors()) {
			expect(sel).not.toContain(":has(");
		}
	});
});
